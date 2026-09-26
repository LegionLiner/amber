package app.yantar.player.library

import java.nio.charset.Charset

/**
 * Починка «кракозябр» в старых русских mp3.
 * Теги ID3v1 и ID3v2.3 часто записаны в Windows-1251, а читаются как Latin-1: «Êèíî» вместо «Кино».
 * Правило: если после перекодировки в 1251 больше половины букв кириллические, берём 1251.
 * Так «Кино» чинится, а «Café» и «Mötley Crüe» остаются как есть.
 */
object TextFix {
    private val CP1251: Charset = Charset.forName("windows-1251")
    private val LATIN1: Charset = Charsets.ISO_8859_1

    private fun isCyr(c: Char) = c in 'А'..'я' || c == 'Ё' || c == 'ё'

    private fun mostlyCyrillic(s: String): Boolean {
        var letters = 0
        var cyr = 0
        for (c in s) {
            if (c.isLetter()) {
                letters++
                if (isCyr(c)) cyr++
            }
        }
        return cyr > 0 && cyr * 2 > letters
    }

    /** Байты тега с кодировкой «Latin-1» (или ID3v1 без кодировки) → строка */
    fun decodeSingleByte(bytes: ByteArray, from: Int = 0, to: Int = bytes.size): String {
        var hasHigh = false
        for (i in from until to) if (bytes[i].toInt() and 0xFF >= 0x80) {
            hasHigh = true
            break
        }
        val latin = String(bytes, from, to - from, LATIN1)
        if (!hasHigh) return latin
        val cyr = String(bytes, from, to - from, CP1251)
        return if (mostlyCyrillic(cyr)) cyr else latin
    }

    /** Строка, которую MediaStore уже прочитал как Latin-1: пробуем перекодировать */
    fun fixString(s: String?): String? {
        if (s.isNullOrEmpty()) return s
        if (s.any { it.code > 0xFF }) return s
        if (s.none { it.code >= 0x80 }) return s
        val bytes = s.toByteArray(LATIN1)
        val cyr = String(bytes, CP1251)
        return if (mostlyCyrillic(cyr)) cyr else s
    }
}
