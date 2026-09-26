package app.yantar.player.playback

import app.yantar.player.db.Database
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.log10
import kotlin.math.pow

/**
 * Громкость треков в памяти движка: результаты анализа (LUFS, тишина по краям)
 * и ReplayGain из тегов. Нужна, чтобы выравнивать громкость и начинать кроссфейд
 * там, где кончается звук, даже когда интерфейс спит.
 */
object Loudness {
    class Info(
        val lufs: Double?,
        val introMs: Long,
        val outroMs: Long,
        val albumKey: String?,
        val rgTrackDb: Double?,
    )

    private val map = ConcurrentHashMap<String, Info>()
    private val albumLufs = ConcurrentHashMap<String, Double>()

    /** Загрузка из базы (в фоновом потоке) */
    fun load() {
        try {
            if (!Database.hasTable("analysis")) return
            val rows = Database.query(
                """SELECT t.key, t.album, t.album_artist, t.rg_track_db, a.lufs, a.intro_silence_ms, a.outro_silence_ms
                   FROM tracks t LEFT JOIN analysis a ON a.key = t.key""",
                emptyList(),
            ).rows
            map.clear()
            for (r in rows) {
                val album = (r[1] as? String)?.lowercase()?.trim()
                val albumKey = if (album.isNullOrEmpty()) null else "$album|${(r[2] as? String)?.lowercase()?.trim() ?: ""}"
                map[r[0] as String] = Info(
                    lufs = (r[4] as? Number)?.toDouble(),
                    introMs = (r[5] as? Number)?.toLong() ?: 0L,
                    outroMs = (r[6] as? Number)?.toLong() ?: 0L,
                    albumKey = albumKey,
                    rgTrackDb = (r[3] as? Number)?.toDouble(),
                )
            }
            recomputeAlbums()
        } catch (_: Exception) {
        }
    }

    fun update(key: String, lufs: Double?, introMs: Long, outroMs: Long) {
        val old = map[key]
        map[key] = Info(lufs, introMs, outroMs, old?.albumKey, old?.rgTrackDb)
        recomputeAlbums()
    }

    /** Громкость альбома = энергетическое среднее громкостей его треков */
    private fun recomputeAlbums() {
        val sums = HashMap<String, Pair<Double, Int>>()
        for (info in map.values) {
            val a = info.albumKey ?: continue
            val l = info.lufs ?: continue
            val (s, n) = sums[a] ?: (0.0 to 0)
            sums[a] = (s + 10.0.pow(l / 10)) to (n + 1)
        }
        albumLufs.clear()
        for ((a, sn) in sums) if (sn.second > 0) albumLufs[a] = 10 * log10(sn.first / sn.second)
    }

    fun get(key: String): Info? = map[key]

    /** Поправка в дБ для трека по режиму нормализации */
    fun normalizationDb(key: String, mode: String, targetLufs: Double, fromAlbum: Boolean): Double {
        if (mode == "off") return 0.0
        val info = map[key] ?: return 0.0
        val useAlbum = mode == "album" || (mode == "smart" && fromAlbum)
        val loud = if (useAlbum) info.albumKey?.let { albumLufs[it] } ?: info.lufs else info.lufs
        if (loud != null) return targetLufs - loud
        // Анализа ещё нет: ReplayGain рассчитан на −18 LUFS, пересчитываем к нашей цели
        info.rgTrackDb?.let { return it + (targetLufs + 18.0) }
        return 0.0
    }
}
