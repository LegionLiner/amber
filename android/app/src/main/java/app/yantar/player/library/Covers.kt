package app.yantar.player.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Обложки хранятся в files/covers/<hash>_s|m|l.webp (160, 480, 1080 px).
 * Имя = хеш картинки, поэтому у треков одного альбома файл один.
 * Из средней версии вынимаются два цвета для фона плеера.
 */
object Covers {
    private val SIZES = listOf("s" to 160, "m" to 480, "l" to 1080)
    private val colorCache = HashMap<String, Pair<String?, String?>>()

    class Saved(val hash: String, val color1: String?, val color2: String?)

    fun dir(ctx: Context): File = File(ctx.filesDir, "covers").apply { mkdirs() }

    fun hashOf(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-1").digest(bytes)
        return md.joinToString("") { "%02x".format(it) }.take(16)
    }

    fun save(ctx: Context, bytes: ByteArray): Saved? {
        val hash = hashOf(bytes)
        colorCache[hash]?.let { return Saved(hash, it.first, it.second) }
        val d = dir(ctx)
        val large = File(d, "${hash}_l.webp")
        val medium = File(d, "${hash}_m.webp")
        var paletteSource: Bitmap? = null
        try {
            if (!large.exists() || !medium.exists()) {
                val src = decodeSquare(bytes, 1080) ?: return null
                for ((suffix, px) in SIZES) {
                    val target = minOf(px, src.width)
                    val scaled = if (target == src.width) src else Bitmap.createScaledBitmap(src, target, target, true)
                    FileOutputStream(File(d, "${hash}_$suffix.webp")).use { out ->
                        scaled.compress(Bitmap.CompressFormat.WEBP_LOSSY, 82, out)
                    }
                    if (suffix == "m") paletteSource = scaled
                    else if (scaled !== src) scaled.recycle()
                }
                if (paletteSource == null) paletteSource = src
            } else {
                paletteSource = BitmapFactory.decodeFile(medium.path)
            }
            val colors = paletteSource?.let { colorsOf(it) } ?: (null to null)
            colorCache[hash] = colors
            return Saved(hash, colors.first, colors.second)
        } catch (_: Throwable) {
            return null
        }
    }

    private fun decodeSquare(bytes: ByteArray, maxPx: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null
        val side = minOf(bmp.width, bmp.height)
        val square = if (bmp.width == bmp.height) bmp else Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
        if (square.width <= maxPx) return square
        return Bitmap.createScaledBitmap(square, maxPx, maxPx, true)
    }

    private fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and c)

    private fun colorsOf(bmp: Bitmap): Pair<String?, String?> {
        val p = Palette.from(bmp).maximumColorCount(16).generate()
        val dark = p.darkVibrantSwatch ?: p.darkMutedSwatch ?: p.dominantSwatch
        val light = p.vibrantSwatch ?: p.lightVibrantSwatch ?: p.mutedSwatch ?: p.dominantSwatch
        return dark?.rgb?.let(::hex) to light?.rgb?.let(::hex)
    }

    fun clearCache() = colorCache.clear()
}
