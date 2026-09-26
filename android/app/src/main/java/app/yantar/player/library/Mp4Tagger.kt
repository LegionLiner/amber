package app.yantar.player.library

import java.io.ByteArrayOutputStream

/** Что лежит в файле на самом деле — по байтам, а не по расширению */
enum class AudioKind { MPEG, MP4, FLAC, OGG, WAV, ID3_MP4, UNKNOWN }

object AudioFormat {
    private fun ascii(b: ByteArray, p: Int, n: Int): String =
        if (p + n <= b.size) String(b, p, n, Charsets.ISO_8859_1) else ""

    private fun mpegSync(b: ByteArray, p: Int): Boolean =
        p + 1 < b.size && b[p] == 0xFF.toByte() && (b[p + 1].toInt() and 0xE0) == 0xE0 && ((b[p + 1].toInt() shr 1) and 3) != 0

    /**
     * head — начало файла (хотя бы 16 байт), afterTag — 16 байт сразу после ID3-тега, если он есть.
     * ID3_MP4 — MP4, перед которым дописан ID3: так файлы портила старая запись тегов, их надо чинить.
     */
    fun sniff(head: ByteArray, afterTag: ByteArray?): AudioKind {
        val t = Id3Reader.tagSize(head)
        if (t > 0) {
            val a = afterTag ?: ByteArray(0)
            if (ascii(a, 4, 4) == "ftyp") return AudioKind.ID3_MP4
            if (ascii(a, 0, 4) == "fLaC") return AudioKind.FLAC
            return AudioKind.MPEG
        }
        if (ascii(head, 4, 4) == "ftyp") return AudioKind.MP4
        return when (ascii(head, 0, 4)) {
            "fLaC" -> AudioKind.FLAC
            "OggS" -> AudioKind.OGG
            "RIFF" -> AudioKind.WAV
            else -> if (mpegSync(head, 0)) AudioKind.MPEG else AudioKind.UNKNOWN
        }
    }

    fun sniff(file: ByteArray): AudioKind {
        val t = Id3Reader.tagSize(file.copyOfRange(0, minOf(10, file.size)))
        val after = if (t > 0 && t < file.size) file.copyOfRange(t, minOf(file.size, t + 16)) else null
        return sniff(file.copyOfRange(0, minOf(16, file.size)), after)
    }
}

/**
 * Теги MP4/M4A (AAC) в формате iTunes: moov/udta/meta/ilst. Порт src/native/web/mp4.ts.
 * Аудио не трогается: если данные лежат после moov, таблицы смещений кусков (stco/co64)
 * сдвигаются на изменение размера moov.
 */
object Mp4Tagger {
    private class Box(val type: String, val start: Int, val header: Int, val end: Int)

    private const val NAM = "©nam"
    private const val ART = "©ART"
    private const val ALB = "©alb"
    private const val GEN = "©gen"
    private const val DAY = "©day"
    private const val TRKN = "trkn"
    private const val GNRE = "gnre"

    private fun u32(b: ByteArray, p: Int): Long =
        ((b[p].toLong() and 0xFF) shl 24) or ((b[p + 1].toLong() and 0xFF) shl 16) or
            ((b[p + 2].toLong() and 0xFF) shl 8) or (b[p + 3].toLong() and 0xFF)

    private fun u64(b: ByteArray, p: Int): Long = (u32(b, p) shl 32) or u32(b, p + 4)

    private fun type(b: ByteArray, p: Int) = String(b, p, 4, Charsets.ISO_8859_1)

    private fun boxes(b: ByteArray, start: Int, end: Int): List<Box> {
        val out = ArrayList<Box>()
        var p = start
        while (p + 8 <= end) {
            var size = u32(b, p)
            var header = 8
            if (size == 1L) {
                size = u64(b, p + 8)
                header = 16
            } else if (size == 0L) size = (end - p).toLong()
            require(size >= header && p + size <= end) { "MP4: битая коробка ${type(b, p + 4)}" }
            out.add(Box(type(b, p + 4), p, header, (p + size).toInt()))
            p = (p + size).toInt()
        }
        return out
    }

    private fun be32(n: Long): ByteArray =
        byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())

    private fun box(type: String, payload: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(payload.size + 8)
        out.write(be32((payload.size + 8).toLong()))
        out.write(type.toByteArray(Charsets.ISO_8859_1))
        out.write(payload)
        return out.toByteArray()
    }

    private fun textItem(type: String, value: String): ByteArray {
        val data = box("data", be32(1) + be32(0) + value.toByteArray(Charsets.UTF_8))
        return box(type, data)
    }

    private fun trackItem(no: Int, total: Int): ByteArray {
        val v = byteArrayOf(0, 0, (no shr 8).toByte(), no.toByte(), (total shr 8).toByte(), total.toByte(), 0, 0)
        return box(TRKN, box("data", be32(0) + be32(0) + v))
    }

    fun write(file: ByteArray, edit: Id3Writer.Edit): ByteArray {
        val top = boxes(file, 0, file.size)
        require(top.firstOrNull()?.type == "ftyp") { "Не MP4: нет ftyp в начале" }
        require(top.none { it.type == "moof" }) { "Фрагментированный MP4 не поддерживается" }
        val moov = top.firstOrNull { it.type == "moov" } ?: error("В MP4 нет moov")

        val kids = boxes(file, moov.start + moov.header, moov.end)
        val udta = kids.firstOrNull { it.type == "udta" }
        val udtaKids = udta?.let { boxes(file, it.start + it.header, it.end) } ?: emptyList()
        val meta = udtaKids.firstOrNull { it.type == "meta" }
        val metaKids = meta?.let { boxes(file, it.start + it.header + 4, it.end) } ?: emptyList()
        val ilst = metaKids.firstOrNull { it.type == "ilst" }
        val items = ilst?.let { boxes(file, it.start + it.header, it.end) } ?: emptyList()

        // «Из скольких» у номера трека сохраняем
        var total = 0
        items.firstOrNull { it.type == TRKN }?.let { t ->
            boxes(file, t.start + t.header, t.end).firstOrNull { it.type == "data" }?.let { d ->
                val v = d.start + d.header + 8
                if (d.end - v >= 6) total = ((file[v + 4].toInt() and 0xFF) shl 8) or (file[v + 5].toInt() and 0xFF)
            }
        }

        val replace = LinkedHashMap<String, ByteArray?>()
        fun text(type: String, v: String?) {
            if (v != null) replace[type] = v.trim().takeIf { it.isNotEmpty() }?.let { textItem(type, it) }
        }
        text(NAM, edit.title)
        text(ART, edit.artist)
        text(ALB, edit.album)
        if (edit.genre != null) {
            text(GEN, edit.genre)
            replace[GNRE] = null // числовой жанр перебил бы текстовый
        }
        edit.year?.let { replace[DAY] = if (it > 0) textItem(DAY, it.toString()) else null }
        edit.trackNo?.let { replace[TRKN] = if (it > 0) trackItem(it, total) else null }

        val newItems = ByteArrayOutputStream()
        val done = HashSet<String>()
        for (it in items) {
            if (replace.containsKey(it.type)) {
                val r = replace[it.type]
                if (r != null && done.add(it.type)) newItems.write(r) else done.add(it.type)
            } else newItems.write(file, it.start, it.end - it.start)
        }
        for ((t, r) in replace) if (t !in done && r != null) newItems.write(r)

        val metaBody = ByteArrayOutputStream()
        metaBody.write(ByteArray(4))
        val hdlr = metaKids.firstOrNull { it.type == "hdlr" }
        if (hdlr != null) metaBody.write(file, hdlr.start, hdlr.end - hdlr.start)
        else metaBody.write(box("hdlr", ByteArray(8) + "mdirappl".toByteArray(Charsets.ISO_8859_1) + ByteArray(9)))
        metaBody.write(box("ilst", newItems.toByteArray()))
        for (k in metaKids) if (k.type !in setOf("hdlr", "ilst", "free")) metaBody.write(file, k.start, k.end - k.start)
        // Небольшой запас: следующие правки часто уложатся без сдвига аудио
        metaBody.write(box("free", ByteArray(512)))
        val newMeta = box("meta", metaBody.toByteArray())

        val udtaBody = ByteArrayOutputStream()
        for (k in udtaKids) if (k.type != "meta") udtaBody.write(file, k.start, k.end - k.start)
        udtaBody.write(newMeta)
        val newUdta = box("udta", udtaBody.toByteArray())

        val moovBody = ByteArrayOutputStream()
        var placed = false
        for (k in kids) {
            if (k.type == "udta") {
                moovBody.write(newUdta)
                placed = true
            } else moovBody.write(file, k.start, k.end - k.start)
        }
        if (!placed) moovBody.write(newUdta)
        val newMoov = box("moov", moovBody.toByteArray())
        val delta = newMoov.size - (moov.end - moov.start)
        if (delta != 0) shiftChunkOffsets(newMoov, moov.start.toLong(), delta.toLong())

        val out = ByteArrayOutputStream(file.size + delta)
        out.write(file, 0, moov.start)
        out.write(newMoov)
        out.write(file, moov.end, file.size - moov.end)
        return out.toByteArray()
    }

    /** Сдвигает в stco/co64 все смещения, указывающие дальше начала старой moov */
    private fun shiftChunkOffsets(moov: ByteArray, moovStart: Long, delta: Long) {
        fun put32(p: Int, v: Long) = System.arraycopy(be32(v), 0, moov, p, 4)
        fun walk(start: Int, end: Int) {
            for (b in boxes(moov, start, end)) {
                when (b.type) {
                    "moov", "trak", "mdia", "minf", "stbl", "edts" -> walk(b.start + b.header, b.end)
                    "stco", "co64" -> {
                        val p = b.start + b.header + 4
                        val n = u32(moov, p).toInt()
                        val wide = b.type == "co64"
                        for (i in 0 until n) {
                            val at = p + 4 + i * (if (wide) 8 else 4)
                            val v = if (wide) u64(moov, at) else u32(moov, at)
                            if (v < moovStart) continue
                            val nv = v + delta
                            if (wide) {
                                put32(at, nv ushr 32)
                                put32(at + 4, nv and 0xFFFFFFFFL)
                            } else {
                                require(nv <= 0xFFFFFFFFL) { "MP4 больше 4 ГБ" }
                                put32(at, nv)
                            }
                        }
                    }
                }
            }
        }
        walk(0, moov.size)
    }

    /** Проверка перед записью на диск: коробки покрывают файл, смещения кусков внутри файла */
    fun verify(file: ByteArray): Boolean = try {
        val top = boxes(file, 0, file.size)
        val moov = top.first { it.type == "moov" }
        val mdat = top.filter { it.type == "mdat" }
        var ok = top.first().type == "ftyp" && top.last().end == file.size && mdat.isNotEmpty()
        fun walk(start: Int, end: Int) {
            for (b in boxes(file, start, end)) {
                when (b.type) {
                    "trak", "mdia", "minf", "stbl" -> walk(b.start + b.header, b.end)
                    "stco", "co64" -> {
                        val p = b.start + b.header + 4
                        val n = u32(file, p).toInt()
                        val wide = b.type == "co64"
                        for (i in 0 until n) {
                            val at = p + 4 + i * (if (wide) 8 else 4)
                            val v = if (wide) u64(file, at) else u32(file, at)
                            if (mdat.none { v >= it.start + it.header && v < it.end }) ok = false
                        }
                    }
                }
            }
        }
        walk(moov.start + moov.header, moov.end)
        ok
    } catch (_: Exception) {
        false
    }

    /**
     * Файл «ID3 + MP4»: исходный MP4 и правка из приписанного тега (её переносим в теги MP4).
     */
    fun unwrapId3(file: ByteArray): Pair<ByteArray, Id3Writer.Edit>? {
        val t = Id3Reader.tagSize(file.copyOfRange(0, minOf(10, file.size)))
        if (t <= 0 || t + 8 > file.size || type(file, t + 4) != "ftyp") return null
        val tags = Id3Reader.parseV2(file.copyOfRange(0, t))
        val edit = Id3Writer.Edit(tags?.title, tags?.artist, tags?.album, tags?.genre, tags?.year, tags?.trackNo)
        return file.copyOfRange(t, file.size) to edit
    }
}
