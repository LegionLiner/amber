package app.yantar.player.library

import app.yantar.player.db.Database
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest

/**
 * Отпечаток трека (track_key): SHA-1 от размера аудиоданных и их первых 64 КБ, первые 20 hex-символов.
 *  - mp3: аудио — всё после ID3-тега, поэтому правка тегов отпечаток не меняет;
 *  - MP4: аудио — содержимое коробки mdat. Раньше брались первые 64 КБ файла, а у MP4 с moov в начале
 *    их меняла любая правка тегов; старые отпечатки переводятся на новые через key_aliases.
 * Тот же расчёт в src/native/web/id3.ts (trackKey) и src/native/web/mp4.ts (mp4Key).
 */
object TrackKey {
    fun sha(audioSize: Long, sample: ByteArray, len: Int): String {
        val md = MessageDigest.getInstance("SHA-1")
        md.update(ByteBuffer.allocate(8).putLong(audioSize).array())
        md.update(sample, 0, len)
        return md.digest().joinToString("") { "%02x".format(it) }.take(20)
    }

    private fun FileChannel.readAt(buf: ByteBuffer, pos: Long) {
        var p = pos
        while (buf.hasRemaining()) {
            val n = read(buf, p)
            if (n <= 0) break
            p += n
        }
    }

    /** Отпечаток MP4 по mdat; null — если коробки не нашлись (тогда считаем по-старому) */
    fun mp4(ch: FileChannel): String? {
        val size = ch.size()
        var p = 0L
        var guard = 0
        while (p + 8 <= size && guard++ < 64) {
            val h = ByteBuffer.allocate(16)
            ch.readAt(h, p)
            val a = h.array()
            var box = ((a[0].toLong() and 0xFF) shl 24) or ((a[1].toLong() and 0xFF) shl 16) or ((a[2].toLong() and 0xFF) shl 8) or (a[3].toLong() and 0xFF)
            var header = 8
            if (box == 1L) {
                box = ByteBuffer.wrap(a, 8, 8).long
                header = 16
            } else if (box == 0L) box = size - p
            if (box < header) return null
            if (String(a, 4, 4, Charsets.ISO_8859_1) == "mdat") {
                val payload = box - header
                val sample = ByteBuffer.allocate(minOf(65536L, payload).toInt().coerceAtLeast(0))
                ch.readAt(sample, p + header)
                return sha(payload, sample.array(), sample.position())
            }
            p += box
        }
        return null
    }

    fun mp4(bytes: ByteArray): String? {
        var p = 0
        var guard = 0
        while (p + 8 <= bytes.size && guard++ < 64) {
            var box = ((bytes[p].toLong() and 0xFF) shl 24) or ((bytes[p + 1].toLong() and 0xFF) shl 16) or
                ((bytes[p + 2].toLong() and 0xFF) shl 8) or (bytes[p + 3].toLong() and 0xFF)
            var header = 8
            if (box == 1L) {
                box = ByteBuffer.wrap(bytes, p + 8, 8).long
                header = 16
            } else if (box == 0L) box = (bytes.size - p).toLong()
            if (box < header || p + box > bytes.size) return null
            if (String(bytes, p + 4, 4, Charsets.ISO_8859_1) == "mdat") {
                val payload = box - header
                val len = minOf(65536L, payload).toInt()
                return sha(payload, bytes.copyOfRange(p + header, p + header + len), len)
            }
            p += box.toInt()
        }
        return null
    }
}

/**
 * Переименование отпечатков: старый → новый. Пары копятся в key_aliases, а fixup одним проходом
 * по каждой таблице переводит все ссылки на новый ключ — историю, оценки, плейлисты, метки, чарты.
 * Добавляешь таблицу с ключом трека в src/data/migrations.ts — добавь её и сюда (и в src/data/rekey.ts).
 */
object KeyAliases {
    private val COLUMNS = listOf(
        "track_user" to "key",
        "play_events" to "track_key",
        "rating_history" to "key",
        "playlist_items" to "track_key",
        "bookmarks" to "track_key",
        "track_tags" to "track_key",
        "duels" to "a_key",
        "duels" to "b_key",
        "rank_snapshots" to "track_key",
        "weekly_charts" to "track_key",
        "analysis" to "key",
        "track_neighbors" to "key",
        "track_neighbors" to "other",
        "lyrics" to "key",
        "dismissed" to "key",
    )

    fun add(old: String, new: String) {
        if (old == new || !Database.hasTable("key_aliases")) return
        Database.execute(
            "INSERT OR REPLACE INTO key_aliases (old, new, at) VALUES (?, ?, ?)",
            listOf(old, new, System.currentTimeMillis()),
        )
    }

    /** Перевести все ссылки со старых ключей на новые. Дёшево: по одному запросу на таблицу */
    fun fixup() {
        if (!Database.hasTable("key_aliases")) return
        val any = Database.query("SELECT 1 FROM key_aliases LIMIT 1", emptyList()).rows.isNotEmpty()
        if (!any) return
        val stmts = ArrayList<Pair<String, List<Any?>>>()
        for ((t, c) in COLUMNS) {
            if (!Database.hasTable(t)) continue
            stmts.add(
                "UPDATE OR IGNORE $t SET $c = (SELECT new FROM key_aliases WHERE old = $t.$c) WHERE $c IN (SELECT old FROM key_aliases)" to emptyList(),
            )
        }
        // Строка трека: переименовать, а если под новым ключом строка уже есть — старую убрать
        stmts.add("UPDATE OR IGNORE tracks SET key = (SELECT new FROM key_aliases WHERE old = tracks.key) WHERE key IN (SELECT old FROM key_aliases)" to emptyList())
        stmts.add("DELETE FROM tracks WHERE key IN (SELECT old FROM key_aliases)" to emptyList())
        Database.batch(stmts)
    }

    /** Карта старый → новый для переименования ключей в очереди, которая уже в памяти */
    fun map(): Map<String, String> {
        if (!Database.hasTable("key_aliases")) return emptyMap()
        return Database.query("SELECT old, new FROM key_aliases", emptyList()).rows.associate { (it[0] as String) to (it[1] as String) }
    }
}
