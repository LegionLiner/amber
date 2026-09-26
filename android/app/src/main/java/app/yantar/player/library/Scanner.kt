package app.yantar.player.library

import android.content.ContentUris
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import app.yantar.player.db.Database
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest

/**
 * Сканер библиотеки. Берёт список аудио из MediaStore, для новых и изменённых файлов
 * сам читает теги и считает отпечаток, пишет в таблицу tracks.
 *
 * Отпечаток (track_key) = SHA-1 от размера аудиоданных и первых 64 КБ после ID3-тега.
 * Правка тегов, переименование и перенос файла его не меняют: оценки и история остаются с треком.
 */
class Scanner(private val ctx: Context) {

    class Options(val full: Boolean, val minDurationMs: Long, val exclude: List<String>)

    class Result(
        val total: Int,
        val added: Int,
        val updated: Int,
        val unchanged: Int,
        val missing: Int,
        val tookMs: Long,
    )

    private class Row(
        val id: Long,
        val path: String,
        val folder: String,
        val name: String,
        val size: Long,
        val mtime: Long,
        val addedAt: Long,
        val durationMs: Long,
        val title: String?,
        val artist: String?,
        val album: String?,
        val albumArtist: String?,
        val genre: String?,
        val year: Int?,
        val track: Int?,
        val mime: String?,
        val bitrate: Int?,
    )

    private class Existing(val key: String, val mtime: Long, val size: Long)

    private val collection: Uri = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)

    fun run(opts: Options, progress: (phase: String, done: Int, total: Int) -> Unit): Result {
        val t0 = SystemClock.elapsedRealtime()
        Covers.clearCache()
        val rows = listMediaStore(opts)
        progress("list", 0, rows.size)

        val existing = HashMap<Long, Existing>()
        val knownKeys = HashSet<String>()
        for (r in Database.query("SELECT key, media_id, mtime, size FROM tracks", emptyList()).rows) {
            val key = r[0] as String
            knownKeys.add(key)
            val mediaId = r[1] as? Long ?: continue
            existing[mediaId] = Existing(key, (r[2] as? Long) ?: 0L, (r[3] as? Long) ?: 0L)
        }

        val seen = LinkedHashSet<String>()
        var added = 0
        var updated = 0
        var unchanged = 0
        val pending = ArrayList<Pair<String, List<Any?>>>()
        val now = System.currentTimeMillis()

        rows.forEachIndexed { i, r ->
            val ex = existing[r.id]
            if (!opts.full && ex != null && ex.mtime == r.mtime && ex.size == r.size) {
                seen.add(ex.key)
                unchanged++
            } else {
                val parsed = try {
                    read(r)
                } catch (_: Throwable) {
                    null
                }
                if (parsed != null && seen.add(parsed.key)) {
                    if (knownKeys.contains(parsed.key)) updated++ else added++
                    pending.add(upsert(r, parsed, now))
                    if (pending.size >= 100) {
                        Database.batch(pending)
                        pending.clear()
                    }
                }
            }
            if (i % 20 == 0) progress("tags", i, rows.size)
        }
        if (pending.isNotEmpty()) Database.batch(pending)

        // Мягкое удаление: пропавшие файлы помечаются, история остаётся
        val stmts = ArrayList<Pair<String, List<Any?>>>()
        stmts.add("CREATE TEMP TABLE IF NOT EXISTS seen_keys (key TEXT PRIMARY KEY)" to emptyList())
        stmts.add("DELETE FROM seen_keys" to emptyList())
        for (k in seen) stmts.add("INSERT OR IGNORE INTO seen_keys (key) VALUES (?)" to listOf(k))
        stmts.add(
            "UPDATE tracks SET missing_since = ? WHERE missing_since IS NULL AND key NOT IN (SELECT key FROM seen_keys)" to listOf(now),
        )
        stmts.add("UPDATE tracks SET missing_since = NULL WHERE missing_since IS NOT NULL AND key IN (SELECT key FROM seen_keys)" to emptyList())
        stmts.add("DROP TABLE seen_keys" to emptyList())
        val res = Database.batch(stmts)
        val missing = res[res.size - 3].changes

        progress("finish", rows.size, rows.size)
        return Result(seen.size, added, updated, unchanged, missing, SystemClock.elapsedRealtime() - t0)
    }

    private fun listMediaStore(opts: Options): List<Row> {
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ARTIST,
            MediaStore.Audio.Media.GENRE,
            MediaStore.Audio.Media.YEAR,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.BITRATE,
        )
        val exclude = opts.exclude.map { it.lowercase().trimStart('/') }
        val out = ArrayList<Row>()
        ctx.contentResolver.query(
            collection,
            projection,
            "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= ?",
            arrayOf(opts.minDurationMs.toString()),
            null,
        )?.use { c ->
            fun str(i: Int) = if (c.isNull(i)) null else c.getString(i)
            fun int(i: Int) = if (c.isNull(i)) null else c.getInt(i)
            while (c.moveToNext()) {
                val folder = str(2) ?: ""
                val lower = folder.lowercase()
                if (exclude.any { it.isNotEmpty() && lower.startsWith(it) }) continue
                val track = int(14)
                out.add(
                    Row(
                        id = c.getLong(0),
                        path = str(1) ?: "",
                        folder = folder,
                        name = str(3) ?: "",
                        size = c.getLong(4),
                        mtime = c.getLong(5),
                        addedAt = c.getLong(6) * 1000,
                        durationMs = c.getLong(7),
                        title = str(8),
                        artist = str(9),
                        album = str(10),
                        albumArtist = str(11),
                        genre = str(12),
                        year = int(13)?.takeIf { it > 0 },
                        track = track?.let { if (it >= 1000) it % 1000 else it }?.takeIf { it > 0 },
                        mime = str(15),
                        bitrate = int(16),
                    ),
                )
            }
        }
        return out
    }

    private class Parsed(
        val key: String,
        val title: String?,
        val artist: String?,
        val album: String?,
        val albumArtist: String?,
        val genre: String?,
        val year: Int?,
        val trackNo: Int?,
        val discNo: Int?,
        val sampleRate: Int?,
        val bitrate: Int?,
        val art: Covers.Saved?,
        val hasLyrics: Boolean,
        val rgTrack: Double?,
        val rgAlbum: Double?,
        val popm: Int?,
    )

    private fun FileChannel.readFully(buf: ByteBuffer, pos: Long) {
        var p = pos
        while (buf.hasRemaining()) {
            val n = read(buf, p)
            if (n <= 0) break
            p += n
        }
    }

    private fun read(r: Row): Parsed? {
        val uri = ContentUris.withAppendedId(collection, r.id)
        val isMp3 = r.mime == "audio/mpeg" || r.name.endsWith(".mp3", ignoreCase = true)
        ctx.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
            FileInputStream(pfd.fileDescriptor).channel.use { ch ->
                val size = ch.size()
                val head = ByteBuffer.allocate(10)
                ch.readFully(head, 0)
                val tagSize = Id3Reader.tagSize(head.array())
                var tags: Id3Tags? = null
                if (tagSize > 0) {
                    val buf = ByteBuffer.allocate(minOf(tagSize.toLong(), 8L * 1024 * 1024, size).toInt())
                    ch.readFully(buf, 0)
                    tags = Id3Reader.parseV2(buf.array())
                }
                if (isMp3 && size > 128) {
                    val tail = ByteBuffer.allocate(128)
                    ch.readFully(tail, size - 128)
                    Id3Reader.parseV1(tail.array())?.let { v1 -> tags = (tags ?: Id3Tags()).also { it.mergeMissing(v1) } }
                }
                val audioStart = if (tagSize in 1 until size) tagSize.toLong() else 0L
                val sample = ByteBuffer.allocate(minOf(65536L, size - audioStart).toInt().coerceAtLeast(0))
                ch.readFully(sample, audioStart)
                val md = MessageDigest.getInstance("SHA-1")
                md.update(ByteBuffer.allocate(8).putLong(size - audioStart).array())
                md.update(sample.array(), 0, sample.position())
                val key = md.digest().joinToString("") { "%02x".format(it) }.take(20)
                val frame = if (isMp3) Mp3Frame.find(sample.array(), sample.position()) else null

                val t = tags
                var art: Covers.Saved? = t?.picture?.let { Covers.save(ctx, it) }
                if (art == null && !isMp3) art = embeddedPicture(uri)?.let { Covers.save(ctx, it) }

                return if (isMp3) {
                    Parsed(
                        key = key,
                        title = t?.title,
                        artist = t?.artist,
                        album = t?.album,
                        albumArtist = t?.albumArtist,
                        genre = t?.genre,
                        year = t?.year ?: r.year,
                        trackNo = t?.trackNo,
                        discNo = t?.discNo,
                        sampleRate = frame?.sampleRate,
                        bitrate = r.bitrate?.takeIf { it > 0 } ?: frame?.bitrate,
                        art = art,
                        hasLyrics = t?.hasLyrics == true,
                        rgTrack = t?.rgTrackDb,
                        rgAlbum = t?.rgAlbumDb,
                        popm = t?.popm,
                    )
                } else {
                    // FLAC, M4A, OGG: теги в UTF-8, берём из MediaStore, но без его заглушек
                    val base = r.name.substringBeforeLast('.')
                    Parsed(
                        key = key,
                        title = TextFix.fixString(r.title)?.takeIf { it != base },
                        artist = TextFix.fixString(r.artist)?.takeIf { it != "<unknown>" },
                        album = TextFix.fixString(r.album)?.takeIf { it != r.folder.trimEnd('/').substringAfterLast('/') },
                        albumArtist = TextFix.fixString(r.albumArtist),
                        genre = TextFix.fixString(r.genre),
                        year = r.year,
                        trackNo = r.track,
                        discNo = null,
                        sampleRate = null,
                        bitrate = r.bitrate,
                        art = art,
                        hasLyrics = false,
                        rgTrack = null,
                        rgAlbum = null,
                        popm = null,
                    )
                }
            }
        }
        return null
    }

    private fun embeddedPicture(uri: Uri): ByteArray? {
        val mmr = MediaMetadataRetriever()
        return try {
            mmr.setDataSource(ctx, uri)
            mmr.embeddedPicture
        } catch (_: Throwable) {
            null
        } finally {
            mmr.release()
        }
    }

    private fun upsert(r: Row, p: Parsed, now: Long): Pair<String, List<Any?>> {
        val sql = """
            INSERT INTO tracks (key, media_id, uri, path, folder, file_name, size, mtime, title, artist, album,
              album_artist, genre, year, track_no, disc_no, duration_ms, bitrate, sample_rate, mime, art, color1, color2,
              has_lyrics, rg_track_db, rg_album_db, popm, added_at, updated_at, missing_since)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(key) DO UPDATE SET
              media_id = excluded.media_id, uri = excluded.uri, path = excluded.path, folder = excluded.folder,
              file_name = excluded.file_name, size = excluded.size, mtime = excluded.mtime, title = excluded.title,
              artist = excluded.artist, album = excluded.album, album_artist = excluded.album_artist,
              genre = excluded.genre, year = excluded.year, track_no = excluded.track_no, disc_no = excluded.disc_no,
              duration_ms = excluded.duration_ms, bitrate = excluded.bitrate, sample_rate = excluded.sample_rate,
              mime = excluded.mime, art = COALESCE(excluded.art, tracks.art),
              color1 = COALESCE(excluded.color1, tracks.color1), color2 = COALESCE(excluded.color2, tracks.color2),
              has_lyrics = excluded.has_lyrics, rg_track_db = excluded.rg_track_db, rg_album_db = excluded.rg_album_db,
              popm = excluded.popm, updated_at = excluded.updated_at, missing_since = NULL
        """.trimIndent()
        val uri = ContentUris.withAppendedId(collection, r.id).toString()
        return sql to listOf(
            p.key, r.id, uri, r.path, r.folder, r.name, r.size, r.mtime, p.title, p.artist, p.album,
            p.albumArtist, p.genre, p.year, p.trackNo, p.discNo, r.durationMs, p.bitrate, p.sampleRate, r.mime,
            p.art?.hash, p.art?.color1, p.art?.color2, if (p.hasLyrics) 1 else 0, p.rgTrack, p.rgAlbum, p.popm,
            if (r.addedAt > 0) r.addedAt else now, now,
        )
    }
}

/** Первый кадр MPEG: частота дискретизации и битрейт (если MediaStore их не дал) */
object Mp3Frame {
    class Info(val sampleRate: Int, val bitrate: Int)

    private val RATES = arrayOf(intArrayOf(11025, 12000, 8000), intArrayOf(0, 0, 0), intArrayOf(22050, 24000, 16000), intArrayOf(44100, 48000, 32000))
    private val BR_V1_L3 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
    private val BR_V2_L3 = intArrayOf(0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)

    fun find(b: ByteArray, len: Int): Info? {
        var i = 0
        while (i + 4 <= len) {
            if (b[i] == 0xFF.toByte() && (b[i + 1].toInt() and 0xE0) == 0xE0) {
                val version = (b[i + 1].toInt() shr 3) and 0x3
                val layer = (b[i + 1].toInt() shr 1) and 0x3
                val brIdx = (b[i + 2].toInt() shr 4) and 0xF
                val srIdx = (b[i + 2].toInt() shr 2) and 0x3
                if (version != 1 && layer == 1 && brIdx in 1..14 && srIdx < 3) {
                    val sr = RATES[version][srIdx]
                    val br = (if (version == 3) BR_V1_L3 else BR_V2_L3)[brIdx] * 1000
                    if (sr > 0) return Info(sr, br)
                }
            }
            i++
        }
        return null
    }
}
