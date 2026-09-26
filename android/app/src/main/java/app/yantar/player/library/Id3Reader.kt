package app.yantar.player.library

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

/**
 * Разбор ID3v2.2/2.3/2.4 и ID3v1 без внешних библиотек.
 * Читаем только то, что нужно приложению: названия, номера, жанр, год, обложку,
 * наличие текста песни, рейтинг из других плееров (POPM) и ReplayGain.
 */
class Id3Tags {
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var albumArtist: String? = null
    var genre: String? = null
    var year: Int? = null
    var trackNo: Int? = null
    var discNo: Int? = null
    var hasLyrics = false
    /** Текст песни (USLT); может быть в формате LRC с метками [мм:сс.сс] */
    var lyrics: String? = null
    /** Синхронный текст (SYLT): время в мс и строка */
    var syncedLyrics: List<Pair<Long, String>>? = null
    var popm: Int? = null
    var rgTrackDb: Double? = null
    var rgAlbumDb: Double? = null
    var picture: ByteArray? = null
    private var pictureIsFront = false

    fun offerPicture(data: ByteArray, isFront: Boolean) {
        if (data.isEmpty()) return
        if (picture == null || (isFront && !pictureIsFront)) {
            picture = data
            pictureIsFront = isFront
        }
    }

    fun mergeMissing(v1: Id3Tags) {
        if (title.isNullOrBlank()) title = v1.title
        if (artist.isNullOrBlank()) artist = v1.artist
        if (album.isNullOrBlank()) album = v1.album
        if (genre.isNullOrBlank()) genre = v1.genre
        if (year == null) year = v1.year
        if (trackNo == null) trackNo = v1.trackNo
    }
}

object Id3Reader {
    private val UTF16: Charset = Charsets.UTF_16
    private val UTF16BE: Charset = Charsets.UTF_16BE

    /** Полный размер ID3v2-тега по первым 10 байтам файла, 0 если тега нет */
    fun tagSize(header: ByteArray): Int {
        if (header.size < 10) return 0
        if (header[0] != 'I'.code.toByte() || header[1] != 'D'.code.toByte() || header[2] != '3'.code.toByte()) return 0
        val flags = header[5].toInt() and 0xFF
        val body = syncsafe(header, 6)
        val footer = if (header[3].toInt() == 4 && flags and 0x10 != 0) 10 else 0
        return 10 + body + footer
    }

    private fun syncsafe(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0x7F) shl 21) or ((b[o + 1].toInt() and 0x7F) shl 14) or
            ((b[o + 2].toInt() and 0x7F) shl 7) or (b[o + 3].toInt() and 0x7F)

    private fun be32(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0xFF) shl 24) or ((b[o + 1].toInt() and 0xFF) shl 16) or
            ((b[o + 2].toInt() and 0xFF) shl 8) or (b[o + 3].toInt() and 0xFF)

    private fun be24(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0xFF) shl 16) or ((b[o + 1].toInt() and 0xFF) shl 8) or (b[o + 2].toInt() and 0xFF)

    private fun unsync(b: ByteArray, from: Int, to: Int): ByteArray {
        val out = ByteArrayOutputStream(to - from)
        var i = from
        while (i < to) {
            val v = b[i]
            out.write(v.toInt())
            if (v == 0xFF.toByte() && i + 1 < to && b[i + 1] == 0.toByte()) i++
            i++
        }
        return out.toByteArray()
    }

    /** tag — байты тега целиком, начиная с «ID3» (можно обрезанные: берём сколько есть) */
    fun parseV2(tag: ByteArray): Id3Tags? {
        if (tag.size < 10 || tagSize(tag) == 0) return null
        val major = tag[3].toInt()
        if (major !in 2..4) return null
        val flags = tag[5].toInt() and 0xFF
        val declared = syncsafe(tag, 6)
        var data = tag
        var pos = 10
        var end = minOf(tag.size, 10 + declared)
        if (flags and 0x80 != 0 && major < 4) {
            data = unsync(tag, 10, end)
            pos = 0
            end = data.size
        }
        if (flags and 0x40 != 0 && major >= 3 && end - pos > 4) {
            val ext = if (major == 4) syncsafe(data, pos) else be32(data, pos) + 4
            pos += ext.coerceIn(0, end - pos)
        }
        val out = Id3Tags()
        val headerLen = if (major == 2) 6 else 10
        while (pos + headerLen <= end) {
            val id: String
            val size: Int
            var fflags = 0
            if (major == 2) {
                id = String(data, pos, 3, Charsets.ISO_8859_1)
                size = be24(data, pos + 3)
            } else {
                id = String(data, pos, 4, Charsets.ISO_8859_1)
                size = if (major == 4) syncsafe(data, pos + 4) else be32(data, pos + 4)
                fflags = ((data[pos + 8].toInt() and 0xFF) shl 8) or (data[pos + 9].toInt() and 0xFF)
            }
            if (id[0] == '\u0000' || size <= 0) break
            val start = pos + headerLen
            val stop = minOf(end, start + size)
            if (start >= stop) break
            var frame = data.copyOfRange(start, stop)
            if (major == 4) {
                if (fflags and 0x0001 != 0 && frame.size > 4) frame = frame.copyOfRange(4, frame.size)
                if (fflags and 0x0002 != 0) frame = unsync(frame, 0, frame.size)
            }
            // Сжатые и зашифрованные кадры (редкость) пропускаем
            val compressed = if (major == 3) fflags and 0x00C0 != 0 else if (major == 4) fflags and 0x000C != 0 else false
            if (!compressed) readFrame(out, id, frame)
            pos = start + size
        }
        return out
    }

    private fun readFrame(t: Id3Tags, id: String, f: ByteArray) {
        when (id) {
            "TIT2", "TT2" -> t.title = text(f)
            "TPE1", "TP1" -> t.artist = text(f)
            "TALB", "TAL" -> t.album = text(f)
            "TPE2", "TP2" -> t.albumArtist = text(f)
            "TCON", "TCO" -> t.genre = genre(text(f))
            "TYER", "TYE", "TDRC", "TDOR" -> if (t.year == null) t.year = text(f)?.take(4)?.toIntOrNull()
            "TRCK", "TRK" -> t.trackNo = text(f)?.substringBefore('/')?.trim()?.toIntOrNull()
            "TPOS", "TPA" -> t.discNo = text(f)?.substringBefore('/')?.trim()?.toIntOrNull()
            "USLT", "ULT" -> {
                t.hasLyrics = true
                if (t.lyrics == null) t.lyrics = unsyncedLyrics(f)
            }
            "SYLT", "SLT" -> {
                t.hasLyrics = true
                if (t.syncedLyrics == null) t.syncedLyrics = syncedLyrics(f)
            }
            "APIC" -> picture(t, f, v22 = false)
            "PIC" -> picture(t, f, v22 = true)
            "POPM", "POP" -> {
                val z = f.indexOf(0)
                if (z >= 0 && z + 1 < f.size) t.popm = f[z + 1].toInt() and 0xFF
            }
            "TXXX", "TXX" -> {
                val (desc, value) = userText(f) ?: return
                val gain = value.replace(",", ".").replace(Regex("[^0-9.+-]"), "").toDoubleOrNull()
                when (desc.uppercase()) {
                    "REPLAYGAIN_TRACK_GAIN" -> t.rgTrackDb = gain
                    "REPLAYGAIN_ALBUM_GAIN" -> t.rgAlbumDb = gain
                }
            }
        }
    }

    private fun ByteArray.indexOf(b: Int, from: Int = 0): Int {
        for (i in from until size) if (this[i].toInt() and 0xFF == b) return i
        return -1
    }

    /** Декодирует строку с байтом кодировки ID3: 0 = Latin-1 (возможно 1251), 1 = UTF-16 BOM, 2 = UTF-16BE, 3 = UTF-8 */
    private fun decode(enc: Int, b: ByteArray, from: Int, to: Int): String {
        if (from >= to) return ""
        return when (enc) {
            0 -> TextFix.decodeSingleByte(b, from, to)
            1 -> String(b, from, to - from, UTF16)
            2 -> String(b, from, to - from, UTF16BE)
            else -> String(b, from, to - from, Charsets.UTF_8)
        }
    }

    /** Конец строки с учётом ширины терминатора (1 байт или 2 для UTF-16) */
    private fun termEnd(enc: Int, b: ByteArray, from: Int): Int {
        if (enc == 1 || enc == 2) {
            var i = from
            while (i + 1 < b.size) {
                if (b[i] == 0.toByte() && b[i + 1] == 0.toByte()) return i
                i += 2
            }
            return b.size
        }
        val z = b.indexOf(0, from)
        return if (z < 0) b.size else z
    }

    private fun text(f: ByteArray): String? {
        if (f.isEmpty()) return null
        val enc = f[0].toInt()
        val end = termEnd(enc, f, 1)
        return decode(enc, f, 1, end).trim().trimEnd('\u0000').ifBlank { null }
    }

    private fun userText(f: ByteArray): Pair<String, String>? {
        if (f.size < 2) return null
        val enc = f[0].toInt()
        val dEnd = termEnd(enc, f, 1)
        val desc = decode(enc, f, 1, dEnd)
        val vStart = dEnd + if (enc == 1 || enc == 2) 2 else 1
        if (vStart > f.size) return null
        val value = decode(enc, f, vStart, termEnd(enc, f, vStart))
        return desc to value
    }

    /** USLT: кодировка, язык (3 байта), описание, текст */
    private fun unsyncedLyrics(f: ByteArray): String? {
        if (f.size < 5) return null
        val enc = f[0].toInt()
        val descEnd = termEnd(enc, f, 4)
        val start = descEnd + if (enc == 1 || enc == 2) 2 else 1
        if (start >= f.size) return null
        return decode(enc, f, start, f.size).trimEnd('\u0000').ifBlank { null }
    }

    /** SYLT: кодировка, язык, формат времени, тип, описание, затем пары «текст + время (4 байта)» */
    private fun syncedLyrics(f: ByteArray): List<Pair<Long, String>>? {
        if (f.size < 7) return null
        val enc = f[0].toInt()
        val format = f[4].toInt()
        if (format != 2) return null // поддерживаем только миллисекунды
        var p = termEnd(enc, f, 6) + if (enc == 1 || enc == 2) 2 else 1
        val out = ArrayList<Pair<Long, String>>()
        while (p < f.size) {
            val end = termEnd(enc, f, p)
            val text = decode(enc, f, p, end)
            p = end + if (enc == 1 || enc == 2) 2 else 1
            if (p + 4 > f.size) break
            val t = be32(f, p).toLong() and 0xFFFFFFFFL
            p += 4
            out.add(t to text.trim())
        }
        return out.ifEmpty { null }
    }

    private fun picture(t: Id3Tags, f: ByteArray, v22: Boolean) {
        if (f.size < 4) return
        val enc = f[0].toInt()
        var p: Int
        if (v22) {
            p = 4
        } else {
            val mimeEnd = f.indexOf(0, 1)
            if (mimeEnd < 0) return
            p = mimeEnd + 1
        }
        if (p >= f.size) return
        val type = f[p].toInt() and 0xFF
        p++
        val descEnd = termEnd(enc, f, p)
        p = descEnd + if (enc == 1 || enc == 2) 2 else 1
        if (p >= f.size) return
        t.offerPicture(f.copyOfRange(p, f.size), isFront = type == 3)
    }

    private val GENRES = arrayOf(
        "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal",
        "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial",
        "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk",
        "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
        "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic",
        "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta",
        "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes",
        "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock",
    )

    /** «(17)» и «(17)Rock» → «Rock» */
    private fun genre(raw: String?): String? {
        if (raw == null) return null
        val m = Regex("^\\((\\d+)\\)(.*)$").find(raw.trim())
        if (m != null) {
            val rest = m.groupValues[2].trim()
            if (rest.isNotEmpty()) return rest
            return GENRES.getOrNull(m.groupValues[1].toInt())
        }
        raw.trim().toIntOrNull()?.let { return GENRES.getOrNull(it) }
        return raw.trim().ifBlank { null }
    }

    /** ID3v1: последние 128 байт файла */
    fun parseV1(tail: ByteArray): Id3Tags? {
        if (tail.size < 128) return null
        val o = tail.size - 128
        if (tail[o] != 'T'.code.toByte() || tail[o + 1] != 'A'.code.toByte() || tail[o + 2] != 'G'.code.toByte()) return null
        fun field(from: Int, len: Int): String? {
            var end = from + len
            for (i in from until from + len) if (tail[i] == 0.toByte()) {
                end = i
                break
            }
            return TextFix.decodeSingleByte(tail, from, end).trim().ifBlank { null }
        }
        val t = Id3Tags()
        t.title = field(o + 3, 30)
        t.artist = field(o + 33, 30)
        t.album = field(o + 63, 30)
        t.year = field(o + 93, 4)?.toIntOrNull()
        if (tail[o + 125] == 0.toByte() && tail[o + 126] != 0.toByte()) t.trackNo = tail[o + 126].toInt() and 0xFF
        val g = tail[o + 127].toInt() and 0xFF
        t.genre = GENRES.getOrNull(g)
        return t
    }
}
