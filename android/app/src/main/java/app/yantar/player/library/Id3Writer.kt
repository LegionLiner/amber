package app.yantar.player.library

import java.io.ByteArrayOutputStream

/**
 * Запись тегов в mp3: собираем новый ID3v2.3-тег (текст в UTF-16 — его понимают и Windows, и телефоны),
 * переносим все прочие кадры старого тега (обложка, текст песни, рейтинги) и дописываем аудио без изменений.
 * Аудиоданные не трогаются, поэтому отпечаток трека (track_key) остаётся прежним.
 */
object Id3Writer {
    class Edit(
        val title: String?,
        val artist: String?,
        val album: String?,
        val genre: String?,
        val year: Int?,
        val trackNo: Int?,
        /** Новая обложка (JPEG или PNG); null — оставить как есть */
        val picture: ByteArray? = null,
    )

    fun isPng(b: ByteArray) = b.size > 4 && b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() && b[2] == 'N'.code.toByte()

    private class Frame(val id: String, val data: ByteArray)

    private fun syncsafe(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0x7F) shl 21) or ((b[o + 1].toInt() and 0x7F) shl 14) or
            ((b[o + 2].toInt() and 0x7F) shl 7) or (b[o + 3].toInt() and 0x7F)

    private fun be32(b: ByteArray, o: Int): Int =
        ((b[o].toInt() and 0xFF) shl 24) or ((b[o + 1].toInt() and 0xFF) shl 16) or
            ((b[o + 2].toInt() and 0xFF) shl 8) or (b[o + 3].toInt() and 0xFF)

    private fun unsync(b: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(b.size)
        var i = 0
        while (i < b.size) {
            out.write(b[i].toInt())
            if (b[i] == 0xFF.toByte() && i + 1 < b.size && b[i + 1] == 0.toByte()) i++
            i++
        }
        return out.toByteArray()
    }

    /** Кадры существующего тега v2.3/v2.4 (v2.2 не переносим: у него другие имена кадров) */
    private fun readFrames(file: ByteArray, tagSize: Int): List<Frame> {
        if (file.size < 10) return emptyList()
        val major = file[3].toInt()
        if (major != 3 && major != 4) return emptyList()
        val flags = file[5].toInt() and 0xFF
        var body = file.copyOfRange(10, minOf(tagSize, file.size))
        if (flags and 0x80 != 0 && major == 3) body = unsync(body)
        var pos = 0
        if (flags and 0x40 != 0 && body.size > 4) {
            pos = if (major == 4) syncsafe(body, 0) else be32(body, 0) + 4
        }
        val out = ArrayList<Frame>()
        while (pos + 10 <= body.size) {
            val id = String(body, pos, 4, Charsets.ISO_8859_1)
            if (id[0] == '\u0000') break
            val size = if (major == 4) syncsafe(body, pos + 4) else be32(body, pos + 4)
            val fflags = ((body[pos + 8].toInt() and 0xFF) shl 8) or (body[pos + 9].toInt() and 0xFF)
            val start = pos + 10
            val end = minOf(body.size, start + size)
            if (size <= 0 || start >= end) break
            var data = body.copyOfRange(start, end)
            var skip = false
            if (major == 4) {
                if (fflags and 0x000C != 0) skip = true // сжато или зашифровано
                if (fflags and 0x0001 != 0 && data.size > 4) data = data.copyOfRange(4, data.size)
                if (fflags and 0x0002 != 0) data = unsync(data)
            } else if (fflags and 0x00C0 != 0) {
                skip = true
            }
            if (!skip) out.add(Frame(if (id == "TDRC") "TYER" else id, data))
            pos = start + size
        }
        return out
    }

    private fun utf16Text(value: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(1)
        out.write(0xFF)
        out.write(0xFE)
        out.write(value.toByteArray(Charsets.UTF_16LE))
        return out.toByteArray()
    }

    /** v2.3 не знает UTF-8: такие текстовые кадры перекодируем в UTF-16 */
    private fun toV23(f: Frame): Frame? {
        if (f.data.isEmpty() || f.data[0].toInt() != 3) return f
        if (f.id.startsWith("T") && f.id != "TXXX") {
            val text = String(f.data, 1, f.data.size - 1, Charsets.UTF_8).trimEnd('\u0000')
            return Frame(f.id, utf16Text(if (f.id == "TYER") text.take(4) else text))
        }
        if (f.id == "TXXX") {
            val zero = (1 until f.data.size).firstOrNull { f.data[it] == 0.toByte() } ?: return null
            val desc = String(f.data, 1, zero - 1, Charsets.UTF_8)
            val value = String(f.data, zero + 1, f.data.size - zero - 1, Charsets.UTF_8).trimEnd('\u0000')
            val out = ByteArrayOutputStream()
            out.write(1)
            out.write(0xFF)
            out.write(0xFE)
            out.write(desc.toByteArray(Charsets.UTF_16LE))
            out.write(0)
            out.write(0)
            out.write(0xFF)
            out.write(0xFE)
            out.write(value.toByteArray(Charsets.UTF_16LE))
            return Frame("TXXX", out.toByteArray())
        }
        if (f.id == "APIC") {
            // Пустое или ASCII-описание картинки можно оставить как Latin-1
            val copy = f.data.copyOf()
            copy[0] = 0
            return Frame("APIC", copy)
        }
        return null
    }

    fun rewrite(file: ByteArray, edit: Edit): ByteArray {
        val header = file.copyOfRange(0, minOf(10, file.size))
        val tagSize = Id3Reader.tagSize(header).coerceAtMost(file.size)
        val old = if (tagSize > 0) readFrames(file, tagSize) else emptyList()

        val replaced = HashMap<String, String>()
        edit.title?.let { replaced["TIT2"] = it }
        edit.artist?.let { replaced["TPE1"] = it }
        edit.album?.let { replaced["TALB"] = it }
        edit.genre?.let { replaced["TCON"] = it }
        edit.year?.let { replaced["TYER"] = it.toString() }
        edit.trackNo?.let { replaced["TRCK"] = it.toString() }

        val body = ByteArrayOutputStream()
        fun writeFrame(id: String, data: ByteArray) {
            body.write(id.toByteArray(Charsets.ISO_8859_1))
            val n = data.size
            body.write(byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte()))
            body.write(0)
            body.write(0)
            body.write(data)
        }
        for ((id, value) in replaced) if (value.isNotBlank()) writeFrame(id, utf16Text(value.trim()))
        edit.picture?.let { pic ->
            // APIC: кодировка, MIME, тип «обложка спереди» (3), пустое описание, картинка
            val apic = ByteArrayOutputStream()
            apic.write(0)
            apic.write((if (isPng(pic)) "image/png" else "image/jpeg").toByteArray(Charsets.ISO_8859_1))
            apic.write(0)
            apic.write(3)
            apic.write(0)
            apic.write(pic)
            writeFrame("APIC", apic.toByteArray())
        }
        for (f in old) {
            if (f.id in replaced) continue
            if (f.id == "APIC" && edit.picture != null) continue
            toV23(f)?.let { writeFrame(it.id, it.data) }
        }
        // Запас на будущие правки, чтобы не переписывать файл целиком каждый раз
        body.write(ByteArray(1024))

        val bytes = body.toByteArray()
        val n = bytes.size
        val tag = ByteArrayOutputStream()
        tag.write("ID3".toByteArray(Charsets.ISO_8859_1))
        tag.write(byteArrayOf(3, 0, 0))
        tag.write(byteArrayOf(((n shr 21) and 0x7F).toByte(), ((n shr 14) and 0x7F).toByte(), ((n shr 7) and 0x7F).toByte(), (n and 0x7F).toByte()))
        tag.write(bytes)
        tag.write(file, tagSize, file.size - tagSize)
        return tag.toByteArray()
    }
}
