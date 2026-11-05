package app.yantar.player.online

import app.yantar.player.core.Lang
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.provider.MediaStore
import app.yantar.player.library.Id3Writer
import app.yantar.player.library.Mp4Tagger
import org.schabi.newpipe.extractor.MediaFormat as NpFormat
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer

/**
 * Единственная онлайн-функция: аудио из видео YouTube по ссылке.
 *
 * Страницу разбирает NewPipeExtractor (как в NewPipe): название, автор, обложка и прямые ссылки
 * на звуковые дорожки. Берём AAC (m4a) лучшего качества, качаем кусками, перепаковываем из DASH
 * в обычный m4a (MediaMuxer), пишем теги и обложку и кладём в «Музыка/Amber» — дальше это
 * обычный файл в медиатеке, для прослушивания интернет не нужен.
 */
object YouTube {
    class Info(
        val title: String,
        val artist: String,
        val uploader: String,
        val durationMs: Long,
        val thumbnail: String?,
        val audio: AudioStream,
        val id: String,
    )

    class Saved(val uri: Uri, val path: String, val name: String)

    @Volatile private var ready = false

    private fun init() {
        if (ready) return
        synchronized(this) {
            if (!ready) {
                NewPipe.init(HttpDownloader)
                ready = true
            }
        }
    }

    fun info(url: String): Info {
        init()
        val s = StreamInfo.getInfo(ServiceList.YouTube, url.trim())
        val audio = pickAudio(s.audioStreams) ?: error(Lang.t("У этого видео нет отдельной звуковой дорожки", "This video has no separate audio track"))
        val (artist, title) = splitTitle(s.name, s.uploaderName ?: "")
        // Для предпросмотра хватает того, что дала страница; для обложки в файле ниже ищем крупнее
        val thumb = s.thumbnails
            .filter { !it.url.contains("webp") }
            .maxByOrNull { it.width.coerceAtLeast(0) * it.height.coerceAtLeast(0) }?.url
            ?: s.thumbnails.lastOrNull()?.url
        return Info(title, artist, s.uploaderName ?: "", s.duration * 1000, thumb, audio, s.id)
    }

    /** AAC лучшего качества; Opus — только если AAC нет. Дубляж пропускаем: берём основную дорожку */
    private fun pickAudio(list: List<AudioStream>): AudioStream? {
        val direct = list.filter { it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP && it.isUrl }
        val original = direct.filter { it.audioTrackType == null || it.audioTrackType == AudioTrackType.ORIGINAL }.ifEmpty { direct }
        return original.filter { it.format == NpFormat.M4A }.maxByOrNull { it.averageBitrate }
            ?: original.maxByOrNull { it.averageBitrate }
    }

    /** «Исполнитель — Название» из заголовка ролика; без тире исполнитель — канал (без « - Topic») */
    fun splitTitle(name: String, uploader: String): Pair<String, String> {
        val clean = name
            .replace(Regex("""\s*[\(\[](official\s*(music\s*)?(video|audio|lyric video|visualizer)|lyrics?|audio|hd|hq|4k|mv|клип|премьера[^\)\]]*)[\)\]]""", RegexOption.IGNORE_CASE), "")
            .trim()
        val m = Regex("""^(.+?)\s+[-–—]\s+(.+)$""").find(clean)
        if (m != null) return m.groupValues[1].trim() to m.groupValues[2].trim()
        return uploader.removeSuffix(" - Topic").trim().ifEmpty { "YouTube" } to clean
    }

    /**
     * Скачать и сохранить. progress(стадия, сделано, всего): download — байты, save — без чисел.
     * Возвращает уже опубликованный файл в MediaStore.
     */
    fun download(ctx: Context, info: Info, title: String, artist: String, progress: (String, Long, Long) -> Unit): Saved {
        val raw = File(ctx.cacheDir, "yt-${System.nanoTime()}.part")
        val remuxed = File(ctx.cacheDir, "yt-${System.nanoTime()}.m4a")
        try {
            fetch(info.audio.content, raw) { done, total -> progress("download", done, total) }
            progress("save", 0, 0)
            val isAac = info.audio.format == NpFormat.M4A
            if (isAac) remux(raw, remuxed, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            else remux(raw, remuxed, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG)
            var bytes = remuxed.readBytes()
            if (isAac) {
                val cover = bestCover(info)?.let { runCatching { squareJpeg(it) }.getOrNull() }
                // Альбом = название: иначе Android подставит имя папки «Amber»
                bytes = Mp4Tagger.write(bytes, Id3Writer.Edit(title, artist, title, null, null, null, cover))
            }
            return publish(ctx, bytes, title, artist, if (isAac) "m4a" else "ogg", if (isAac) "audio/mp4" else "audio/ogg")
        } finally {
            raw.delete()
            remuxed.delete()
        }
    }

    /** Кусками по 1 МБ с Range: одним запросом YouTube отдаёт звук медленнее реального времени */
    private fun fetch(url: String, out: File, progress: (Long, Long) -> Unit) {
        val ua = when {
            YoutubeParsingHelper.isAndroidStreamingUrl(url) -> YoutubeParsingHelper.getAndroidUserAgent(null)
            YoutubeParsingHelper.isIosStreamingUrl(url) -> YoutubeParsingHelper.getIosUserAgent(null)
            YoutubeParsingHelper.isVisionOsStreamingUrl(url) -> YoutubeParsingHelper.getVisionOsUserAgent(null)
            else -> HttpDownloader.USER_AGENT
        }
        val web = YoutubeParsingHelper.isWebStreamingUrl(url) || YoutubeParsingHelper.isWebEmbeddedPlayerStreamingUrl(url)
        var total = -1L
        var done = 0L
        val chunk = 1L shl 20
        FileOutputStream(out).use { fos ->
            while (total < 0 || done < total) {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 15_000
                c.readTimeout = 30_000
                c.setRequestProperty("User-Agent", ua)
                c.setRequestProperty("Range", "bytes=$done-${done + chunk - 1}")
                if (web) {
                    c.setRequestProperty("Origin", "https://www.youtube.com")
                    c.setRequestProperty("Referer", "https://www.youtube.com/")
                }
                try {
                    when (c.responseCode) {
                        206 -> {
                            // Content-Range: bytes 0-1048575/4234567
                            total = c.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: total
                        }
                        200 -> total = c.contentLengthLong
                        else -> error(Lang.t("YouTube ответил ${c.responseCode}", "YouTube responded ${c.responseCode}"))
                    }
                    val n = c.inputStream.use { it.copyTo(fos) }
                    if (n == 0L) break
                    done += n
                    progress(done, total)
                    if (c.responseCode == 200) break
                } finally {
                    c.disconnect()
                }
            }
        }
        if (total > 0 && done < total) error(Lang.t("Загрузка оборвалась", "The download was interrupted"))
    }

    /** DASH-кусочки → обычный файл: тот же звук без перекодирования */
    private fun remux(src: File, dst: File, format: Int) {
        val ex = MediaExtractor()
        ex.setDataSource(src.path)
        val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            ?: error(Lang.t("В файле нет звука", "The file has no audio"))
        ex.selectTrack(track)
        val mux = MediaMuxer(dst.path, format)
        try {
            val t = mux.addTrack(ex.getTrackFormat(track))
            mux.start()
            val buf = ByteBuffer.allocate(1 shl 20)
            val info = MediaCodec.BufferInfo()
            while (true) {
                val n = ex.readSampleData(buf, 0)
                if (n < 0) break
                info.set(0, n, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                mux.writeSampleData(t, buf, info)
                ex.advance()
            }
            mux.stop()
        } finally {
            mux.release()
            ex.release()
        }
    }

    /**
     * Самая крупная картинка ролика: maxres (1280×720) есть не у всех, дальше 640×480 и 480×360.
     * У ролика без картинки нужного размера YouTube отдаёт 404 или заглушку 120×90 — такие пропускаем.
     */
    private fun bestCover(info: Info): ByteArray? {
        for (name in listOf("maxresdefault", "sddefault", "hqdefault")) {
            val bytes = runCatching { get("https://i.ytimg.com/vi/${info.id}/$name.jpg") }.getOrNull() ?: continue
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            if (o.outWidth > 200) return bytes
        }
        return info.thumbnail?.let { runCatching { get(it) }.getOrNull() }
    }

    private fun get(url: String): ByteArray {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", HttpDownloader.USER_AGENT)
        return try {
            if (c.responseCode != 200) error("HTTP ${c.responseCode}")
            c.inputStream.use { it.readBytes() }
        } finally {
            c.disconnect()
        }
    }

    /** Превью 16:9 → квадрат по центру (как обложка альбома), JPEG */
    private fun squareJpeg(bytes: ByteArray): ByteArray {
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return bytes
        val side = minOf(bmp.width, bmp.height)
        val sq = Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
        val out = ByteArrayOutputStream()
        sq.compress(Bitmap.CompressFormat.JPEG, 92, out)
        return out.toByteArray()
    }

    /** В «Музыка/Amber» через MediaStore: разрешений не нужно, файл сразу виден системе и медиатеке */
    private fun publish(ctx: Context, bytes: ByteArray, title: String, artist: String, ext: String, mime: String): Saved {
        val cr = ctx.contentResolver
        val base = "$artist - $title".replace(Regex("""[\\/:*?"<>|]"""), "_").take(120)
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, "$base.$ext")
            put(MediaStore.Audio.Media.MIME_TYPE, mime)
            put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/Amber")
            put(MediaStore.Audio.Media.TITLE, title)
            put(MediaStore.Audio.Media.ARTIST, artist)
            put(MediaStore.Audio.Media.IS_MUSIC, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
        val uri = cr.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
            ?: error(Lang.t("Не удалось создать файл в «Музыке»", "Couldn't create a file in “Music”"))
        try {
            cr.openOutputStream(uri, "w")?.use { it.write(bytes) } ?: error(Lang.t("Не удалось записать файл", "Couldn't write the file"))
            cr.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            cr.delete(uri, null, null)
            throw e
        }
        val path = cr.query(uri, arrayOf(MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) (c.getString(0) ?: "") to (c.getString(1) ?: "$base.$ext") else null
        }
        return Saved(uri, path?.first ?: "", path?.second ?: "$base.$ext")
    }

    /** HTTP для NewPipeExtractor (запросы к страницам и API YouTube) */
    private object HttpDownloader : Downloader() {
        const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"

        override fun execute(request: Request): Response {
            val c = URL(request.url()).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.requestMethod = request.httpMethod()
            c.setRequestProperty("User-Agent", USER_AGENT)
            for ((k, vs) in request.headers()) {
                if (vs.isEmpty()) continue
                c.setRequestProperty(k, vs.first())
                vs.drop(1).forEach { c.addRequestProperty(k, it) }
            }
            request.dataToSend()?.let { data ->
                c.doOutput = true
                c.outputStream.use { it.write(data) }
            }
            try {
                val code = c.responseCode
                if (code == 429) throw ReCaptchaException(Lang.t("YouTube просит пройти проверку «я не робот»", "YouTube asks for an “I'm not a robot” check"), request.url())
                val body = (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) }
                return Response(code, c.responseMessage, c.headerFields.filterKeys { it != null }, body, c.url.toString())
            } finally {
                c.disconnect()
            }
        }
    }
}
