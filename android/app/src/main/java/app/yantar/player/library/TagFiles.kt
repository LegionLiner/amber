package app.yantar.player.library

import app.yantar.player.core.Lang
import android.content.Context
import android.net.Uri
import java.io.File

/**
 * Запись тегов в сами файлы — осторожно:
 *  1. формат определяется по байтам (у многих «.mp3» внутри MP4/AAC — ID3 такой файл ломает);
 *  2. результат проверяется до записи на диск;
 *  3. оригинал сохраняется в резервную копию (последние 20 файлов), чтобы можно было вернуть как было;
 *  4. после записи файл перечитывается и сравнивается; если что-то не так — оригинал возвращается.
 */
object TagFiles {
    /** newKey — отпечаток файла после записи, если он отличается от прежнего (MP4 по mdat) */
    class Result(val ok: Boolean, val reason: String? = null, val size: Long = 0, val newKey: String? = null)

    private const val KEEP = 20
    private const val KEEP_BYTES = 250L * 1024 * 1024

    private fun dir(ctx: Context) = File(ctx.filesDir, "tag-backups").apply { mkdirs() }

    private fun label(kind: AudioKind) = when (kind) {
        AudioKind.FLAC -> "FLAC"
        AudioKind.OGG -> "OGG"
        AudioKind.WAV -> "WAV"
        else -> Lang.t("неизвестный", "unknown")
    }

    private fun read(ctx: Context, uri: Uri): ByteArray =
        ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error(Lang.t("Не удалось прочитать файл", "Couldn't read the file"))

    private fun writeRaw(ctx: Context, uri: Uri, bytes: ByteArray) {
        ctx.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: error(Lang.t("Не удалось открыть файл для записи", "Couldn't open the file for writing"))
    }

    /** Записать и убедиться, что на диске ровно то, что нужно; иначе вернуть оригинал */
    private fun commit(ctx: Context, uri: Uri, original: ByteArray, out: ByteArray) {
        try {
            writeRaw(ctx, uri, out)
            val back = read(ctx, uri)
            if (!back.contentEquals(out)) error(Lang.t("файл на диске не совпал с записанным", "the file on disk didn't match what was written"))
        } catch (e: Exception) {
            try {
                writeRaw(ctx, uri, original)
            } catch (_: Exception) {
            }
            throw IllegalStateException("Запись не удалась (${e.message}), файл возвращён как был")
        }
    }

    private fun audioAfterTag(b: ByteArray): Int = Id3Reader.tagSize(b.copyOfRange(0, minOf(10, b.size))).coerceIn(0, b.size)

    private fun merge(old: Id3Writer.Edit, new: Id3Writer.Edit) = Id3Writer.Edit(
        new.title ?: old.title,
        new.artist ?: old.artist,
        new.album ?: old.album,
        new.genre ?: old.genre,
        new.year ?: old.year,
        new.trackNo ?: old.trackNo,
    )

    fun apply(ctx: Context, uri: Uri, key: String, edit: Id3Writer.Edit): Result {
        val original = read(ctx, uri)
        val kind = AudioFormat.sniff(original)
        val out = when (kind) {
            AudioKind.MPEG -> Id3Writer.rewrite(original, edit)
            AudioKind.MP4 -> Mp4Tagger.write(original, edit)
            AudioKind.ID3_MP4 -> {
                val (mp4, old) = Mp4Tagger.unwrapId3(original) ?: error(Lang.t("Не удалось разобрать файл", "Couldn't parse the file"))
                Mp4Tagger.write(mp4, merge(old, edit))
            }
            else -> return Result(false, Lang.t("Формат ${label(kind)}: в файл не пишем, правка сохранена в приложении", "${label(kind)} format: not written to the file, the edit is saved in the app"))
        }
        val good = when (kind) {
            // Аудио после тега должно остаться байт в байт
            AudioKind.MPEG -> {
                val a = audioAfterTag(original)
                val b = audioAfterTag(out)
                AudioFormat.sniff(out) == AudioKind.MPEG && out.size - b == original.size - a &&
                    out.copyOfRange(b, minOf(out.size, b + 65536)).contentEquals(original.copyOfRange(a, minOf(original.size, a + 65536)))
            }
            else -> AudioFormat.sniff(out) == AudioKind.MP4 && Mp4Tagger.verify(out)
        }
        if (!good) return Result(false, Lang.t("Проверка не прошла, файл не тронут", "Verification failed, the file was left untouched"))
        backup(ctx, key, original)
        commit(ctx, uri, original, out)
        return Result(true, size = out.size.toLong(), newKey = if (kind == AudioKind.MPEG) null else TrackKey.mp4(out))
    }

    /** Починка «ID3 + MP4»: убрать приписанный тег, правку из него перенести в теги MP4 */
    fun repair(ctx: Context, uri: Uri, key: String): Result {
        val original = read(ctx, uri)
        val (mp4, edit) = Mp4Tagger.unwrapId3(original) ?: return Result(false, Lang.t("Файл не повреждён", "The file isn't damaged"))
        val out = try {
            Mp4Tagger.write(mp4, edit)
        } catch (_: Exception) {
            mp4 // хотя бы вернуть звук: теги не перенеслись, но файл снова играет
        }
        if (!(AudioFormat.sniff(out) == AudioKind.MP4 && Mp4Tagger.verify(out))) return Result(false, Lang.t("После починки файл не прошёл проверку", "After repair the file failed verification"))
        backup(ctx, key, original)
        commit(ctx, uri, original, out)
        return Result(true, size = out.size.toLong(), newKey = TrackKey.mp4(out))
    }

    fun hasBackup(ctx: Context, key: String) = File(dir(ctx), "$key.bin").exists()

    fun backups(ctx: Context): List<String> = dir(ctx).listFiles()?.filter { it.name.endsWith(".bin") }?.map { it.name.removeSuffix(".bin") } ?: emptyList()

    /** Вернуть файл к состоянию до последней записи тегов */
    fun restore(ctx: Context, uri: Uri, key: String): Result {
        val f = File(dir(ctx), "$key.bin")
        if (!f.exists()) return Result(false, Lang.t("Копии нет", "No copy"))
        val saved = f.readBytes()
        val current = read(ctx, uri)
        commit(ctx, uri, current, saved)
        f.delete()
        return Result(true, size = saved.size.toLong())
    }

    private fun backup(ctx: Context, key: String, bytes: ByteArray) {
        val d = dir(ctx)
        File(d, "$key.bin").writeBytes(bytes)
        val files = d.listFiles()?.filter { it.name.endsWith(".bin") }?.sortedByDescending { it.lastModified() } ?: return
        var total = 0L
        files.forEachIndexed { i, f ->
            total += f.length()
            if (i >= KEEP || total > KEEP_BYTES) f.delete()
        }
    }
}
