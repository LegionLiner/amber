package app.yantar.player.core

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import app.yantar.player.db.Database
import app.yantar.player.library.Covers
import app.yantar.player.library.Id3Reader
import app.yantar.player.library.AudioFormat
import app.yantar.player.library.AudioKind
import app.yantar.player.library.Id3Writer
import app.yantar.player.library.Scanner
import app.yantar.player.library.KeyAliases
import app.yantar.player.library.TagFiles
import app.yantar.player.playback.Loudness
import app.yantar.player.playback.PlayerHub
import app.yantar.player.playback.Preview
import app.yantar.player.tracking.PlayTracker
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Мост между интерфейсом (TypeScript) и движком. Контракт описан в src/native/music-core.ts.
 * Запросы к базе выполняются в отдельном потоке, команды плеера — в главном (так требует ExoPlayer).
 */
@CapacitorPlugin(
    name = "MusicCore",
    permissions = [
        Permission(alias = "audio", strings = [Manifest.permission.READ_MEDIA_AUDIO]),
        Permission(alias = "storage", strings = [Manifest.permission.READ_EXTERNAL_STORAGE]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class MusicCorePlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "yantar-plugin").apply { isDaemon = true } }
    private val scanWork = Executors.newSingleThreadExecutor { r -> Thread(r, "yantar-scan").apply { isDaemon = true } }
    private var preview: Preview? = null

    private var writeLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    /** Что сделать, когда Android разрешит изменить файлы (или откажет) */
    private var pendingWrite: Pair<PluginCall, (Boolean) -> Unit>? = null

    private val hubListener = object : PlayerHub.Listener {
        override fun onState(state: JSONObject) = notifyListeners("state", JSObject.fromJSONObject(state))
        override fun onPlayLogged(event: JSONObject) = notifyListeners("playLogged", JSObject.fromJSONObject(event))
        override fun onNotificationAction(event: JSONObject) = notifyListeners("notificationAction", JSObject.fromJSONObject(event))
        override fun onOutputs(event: JSONObject) = notifyListeners("outputs", JSObject.fromJSONObject(event))
        override fun onAnalysis(event: JSONObject) = notifyListeners("analysisProgress", JSObject.fromJSONObject(event))
        override fun onQueueLow(event: JSONObject) = notifyListeners("queueLow", JSObject.fromJSONObject(event))
    }

    override fun load() {
        PlayerHub.init(context)
        PlayerHub.listeners.add(hubListener)
        PlayerHub.setUiVisible(true)
        writeLauncher = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
            onWritePermission(res)
        }
    }

    override fun handleOnResume() {
        PlayerHub.setUiVisible(true)
    }

    override fun handleOnPause() {
        PlayerHub.setUiVisible(false)
    }

    override fun handleOnDestroy() {
        PlayerHub.listeners.remove(hubListener)
        preview?.stop()
    }

    private fun onMain(call: PluginCall, block: () -> Unit) {
        main.post {
            try {
                block()
            } catch (e: Exception) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    private fun onWork(call: PluginCall, block: () -> Unit) {
        work.execute {
            try {
                block()
            } catch (e: Exception) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    private fun params(arr: JSONArray?): List<Any?> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).map { i ->
            val v = arr.opt(i)
            if (v == null || v == JSONObject.NULL) null else v
        }
    }

    /* ---------------- сервис ---------------- */

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val version = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
        } catch (_: Exception) {
            ""
        }
        val info = JSObject()
            .put("platform", "android")
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("appVersion", version)
            .put("coversDir", Covers.dir(context).absolutePath)
        // База была повреждена и восстановлена при запуске: интерфейс скажет об этом
        Database.takeRecovery(context)?.let { (at, broken) ->
            info.put("dbRecovery", JSObject().put("restoredFrom", at ?: JSONObject.NULL).put("brokenFile", broken ?: JSONObject.NULL))
        }
        call.resolve(info)
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        try {
            val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message)
        }
    }

    /* ---------------- база ---------------- */

    @PluginMethod
    fun query(call: PluginCall) = onWork(call) {
        val r = Database.query(call.getString("sql") ?: "", params(call.getArray("params")))
        val columns = JSArray()
        r.columns.forEach { columns.put(it) }
        val values = JSArray()
        for (row in r.rows) {
            val a = JSONArray()
            for (v in row) a.put(v ?: JSONObject.NULL)
            values.put(a)
        }
        call.resolve(JSObject().put("columns", columns).put("values", values))
    }

    @PluginMethod
    fun execute(call: PluginCall) = onWork(call) {
        val r = Database.execute(call.getString("sql") ?: "", params(call.getArray("params")))
        call.resolve(JSObject().put("changes", r.changes).put("lastId", r.lastId))
    }

    @PluginMethod
    fun batch(call: PluginCall) = onWork(call) {
        val arr = call.getArray("statements") ?: JSArray()
        val statements = (0 until arr.length()).map { i ->
            val s = arr.getJSONObject(i)
            s.optString("sql") to params(s.optJSONArray("params"))
        }
        val results = JSArray()
        for (r in Database.batch(statements)) results.put(JSONObject().put("changes", r.changes).put("lastId", r.lastId))
        call.resolve(JSObject().put("results", results))
    }

    /** Перечитать громкость из базы (после импорта или правки поправок) */
    @PluginMethod
    fun reloadLoudness(call: PluginCall) {
        Database.io.execute { Loudness.load() }
        call.resolve()
    }

    /* ---------------- библиотека ---------------- */

    @PluginMethod
    fun scan(call: PluginCall) {
        val excludeArr = call.getArray("excludeFolders") ?: JSArray()
        val exclude = (0 until excludeArr.length()).map { excludeArr.optString(it) }
        val opts = Scanner.Options(
            full = call.getBoolean("full", false) ?: false,
            minDurationMs = (call.getInt("minDurationMs", 30_000) ?: 30_000).toLong(),
            exclude = exclude,
        )
        scanWork.execute {
            try {
                val r = Scanner(context).run(opts) { phase, done, total ->
                    notifyListeners("scanProgress", JSObject().put("phase", phase).put("done", done).put("total", total))
                }
                Loudness.load()
                PlayerHub.remapKeys(KeyAliases.map())
                call.resolve(
                    JSObject()
                        .put("total", r.total)
                        .put("added", r.added)
                        .put("updated", r.updated)
                        .put("unchanged", r.unchanged)
                        .put("missing", r.missing)
                        .put("tookMs", r.tookMs)
                        .put(
                            "damaged",
                            JSArray(r.damaged.map { d -> JSObject().put("key", d.key).put("uri", d.uri).put("path", d.path).put("name", d.name) }),
                        ),
                )
            } catch (e: SecurityException) {
                call.reject("Нет доступа к музыке", "PERMISSION")
            } catch (e: Exception) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    @PluginMethod
    fun analyze(call: PluginCall) {
        val arr = call.getArray("keys") ?: JSArray()
        val keys = (0 until arr.length()).map { arr.optString(it) }
        PlayerHub.analyze(keys, call.getString("priority") == "now")
        call.resolve()
    }

    /** Текст песни из тегов файла: обычный (USLT, возможно в формате LRC) и синхронный (SYLT) */
    @PluginMethod
    fun lyrics(call: PluginCall) = onWork(call) {
        val uri = Uri.parse(call.getString("uri") ?: "")
        val res = JSObject()
        context.contentResolver.openInputStream(uri)?.use { input ->
            val head = ByteArray(10)
            if (input.read(head) == 10) {
                val size = Id3Reader.tagSize(head)
                if (size > 10) {
                    val rest = ByteArray(minOf(size - 10, 8 * 1024 * 1024))
                    var read = 0
                    while (read < rest.size) {
                        val n = input.read(rest, read, rest.size - read)
                        if (n <= 0) break
                        read += n
                    }
                    Id3Reader.parseV2(head + rest)?.let { t ->
                        t.lyrics?.let { res.put("text", it) }
                        t.syncedLyrics?.let { lines ->
                            val a = JSArray()
                            for ((ms, line) in lines) a.put(JSONObject().put("t", ms).put("line", line))
                            res.put("synced", a)
                        }
                    }
                }
            }
        }
        // Файл .lrc рядом с треком: доступен не на всех версиях Android
        if (!res.has("text") && !res.has("synced")) {
            call.getString("path")?.let { p ->
                val lrc = File(p.substringBeforeLast('.') + ".lrc")
                try {
                    if (lrc.canRead()) res.put("text", lrc.readText())
                } catch (_: Exception) {
                }
            }
        }
        call.resolve(res)
    }

    /**
     * Запись тегов в сами mp3. Android 11+ требует согласия пользователя на изменение чужих файлов:
     * показываем системный запрос, после «Разрешить» переписываем теги и обновляем MediaStore.
     */
    @PluginMethod
    fun writeTags(call: PluginCall) {
        val items = call.getArray("items") ?: JSArray()
        withWriteAccess(call, items) { granted ->
            if (!granted) return@withWriteAccess call.reject("Изменение файлов не разрешено", "CANCELLED")
            onWork(call) { call.resolve(runOnFiles(items) { uri, key, it -> TagFiles.apply(context, uri, key, editOf(it)) }) }
        }
    }

    /** Починить файлы, испорченные старой записью тегов (ID3 перед MP4) */
    @PluginMethod
    fun repairFiles(call: PluginCall) {
        val items = call.getArray("items") ?: JSArray()
        withWriteAccess(call, items) { granted ->
            if (!granted) return@withWriteAccess call.reject("Изменение файлов не разрешено", "CANCELLED")
            onWork(call) { call.resolve(runOnFiles(items) { uri, key, _ -> TagFiles.repair(context, uri, key) }) }
        }
    }

    /** Вернуть файлы к состоянию до последней записи тегов (копии хранятся в приложении) */
    @PluginMethod
    fun restoreTags(call: PluginCall) {
        val items = call.getArray("items") ?: JSArray()
        withWriteAccess(call, items) { granted ->
            if (!granted) return@withWriteAccess call.reject("Изменение файлов не разрешено", "CANCELLED")
            onWork(call) { call.resolve(runOnFiles(items) { uri, key, _ -> TagFiles.restore(context, uri, key) }) }
        }
    }

    /** Формат файлов по байтам: чтобы не просить разрешение на запись там, где писать нечем */
    @PluginMethod
    fun probeFormats(call: PluginCall) {
        val uris = call.getArray("uris") ?: JSArray()
        onWork(call) {
            val kinds = JSArray()
            for (i in 0 until uris.length()) {
                val kind = try {
                    context.contentResolver.openInputStream(Uri.parse(uris.optString(i)))?.use { s ->
                        val head = ByteArray(16).also { s.read(it) }
                        val tag = Id3Reader.tagSize(head)
                        val after = if (tag > 0) {
                            s.skip((tag - 16).toLong().coerceAtLeast(0))
                            ByteArray(16).also { s.read(it) }
                        } else null
                        AudioFormat.sniff(head, after)
                    } ?: AudioKind.UNKNOWN
                } catch (_: Exception) {
                    AudioKind.UNKNOWN
                }
                kinds.put(
                    when (kind) {
                        AudioKind.MPEG -> "mpeg"
                        AudioKind.MP4 -> "mp4"
                        AudioKind.FLAC -> "flac"
                        AudioKind.OGG -> "ogg"
                        AudioKind.WAV -> "wav"
                        AudioKind.ID3_MP4 -> "id3+mp4"
                        AudioKind.UNKNOWN -> "unknown"
                    },
                )
            }
            call.resolve(JSObject().put("kinds", kinds))
        }
    }

    @PluginMethod
    fun tagBackups(call: PluginCall) {
        call.resolve(JSObject().put("keys", JSArray(TagFiles.backups(context))))
    }

    private fun editOf(it: JSONObject): Id3Writer.Edit {
        fun str(n: String) = if (it.has(n) && !it.isNull(n)) it.optString(n) else null
        fun int(n: String) = if (it.has(n) && !it.isNull(n)) it.optInt(n) else null
        val picture = str("picture")?.let { b64 -> android.util.Base64.decode(b64, android.util.Base64.DEFAULT) }
        return Id3Writer.Edit(str("title"), str("artist"), str("album"), str("genre"), int("year"), int("trackNo"), picture)
    }

    /* ---------------- YouTube: единственная онлайн-функция ---------------- */

    private val ytWork = Executors.newSingleThreadExecutor { r -> Thread(r, "yantar-youtube").apply { isDaemon = true } }
    /** Разобранная страница: ссылки на звук живут несколько часов, повторно не разбираем */
    @Volatile private var ytLast: Pair<String, app.yantar.player.online.YouTube.Info>? = null

    private fun ytError(e: Throwable): String = when (e) {
        is org.schabi.newpipe.extractor.exceptions.ReCaptchaException -> "YouTube просит проверку «я не робот». Попробуй позже"
        is org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException -> "Видео с ограничением по возрасту — без входа в аккаунт его не скачать"
        is org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException -> "Видео недоступно: удалено, закрыто или не для этой страны"
        is java.net.UnknownHostException -> "Нет интернета"
        is org.schabi.newpipe.extractor.exceptions.ParsingException -> "Не получилось разобрать страницу YouTube. Возможно, нужна новая версия приложения"
        else -> e.message ?: e.toString()
    }

    @PluginMethod
    fun youtubeInfo(call: PluginCall) {
        val url = call.getString("url")?.trim().orEmpty()
        if (url.isEmpty()) return call.reject("Нет ссылки")
        ytWork.execute {
            try {
                val i = app.yantar.player.online.YouTube.info(url)
                ytLast = url to i
                call.resolve(
                    JSObject()
                        .put("title", i.title)
                        .put("artist", i.artist)
                        .put("uploader", i.uploader)
                        .put("durationMs", i.durationMs)
                        .put("thumbnail", i.thumbnail),
                )
            } catch (e: Throwable) {
                android.util.Log.w("MusicCore", "youtube info", e)
                call.reject(ytError(e))
            }
        }
    }

    @PluginMethod
    fun youtubeDownload(call: PluginCall) {
        val url = call.getString("url")?.trim().orEmpty()
        if (url.isEmpty()) return call.reject("Нет ссылки")
        ytWork.execute {
            try {
                val info = ytLast?.takeIf { it.first == url }?.second ?: app.yantar.player.online.YouTube.info(url)
                val title = call.getString("title")?.trim()?.takeIf { it.isNotEmpty() } ?: info.title
                val artist = call.getString("artist")?.trim()?.takeIf { it.isNotEmpty() } ?: info.artist
                var lastSent = 0L
                val saved = app.yantar.player.online.YouTube.download(context, info, title, artist) { stage, done, total ->
                    val now = System.currentTimeMillis()
                    if (stage != "download" || now - lastSent > 200 || done == total) {
                        lastSent = now
                        notifyListeners("youtubeProgress", JSObject().put("stage", stage).put("done", done).put("total", total))
                    }
                }
                ytLast = null
                call.resolve(JSObject().put("uri", saved.uri.toString()).put("path", saved.path).put("name", saved.name))
            } catch (e: Throwable) {
                android.util.Log.w("MusicCore", "youtube download", e)
                call.reject(ytError(e))
            }
        }
    }

    /** Своя картинка (обложка плейлиста или трека внутри приложения): в общую папку обложек, ответ — её ключ */
    @PluginMethod
    fun saveCover(call: PluginCall) {
        val data = call.getString("data") ?: return call.reject("нет картинки")
        work.execute {
            try {
                val saved = Covers.save(context, android.util.Base64.decode(data, android.util.Base64.DEFAULT))
                    ?: return@execute call.reject("Не удалось прочитать картинку")
                call.resolve(JSObject().put("art", saved.hash).put("color1", saved.color1).put("color2", saved.color2))
            } catch (e: Exception) {
                call.reject(e.message ?: "ошибка")
            }
        }
    }

    /** Системный запрос «Разрешить изменить файлы?» для всех uri сразу */
    private fun withWriteAccess(call: PluginCall, items: JSONArray, then: (Boolean) -> Unit) {
        if (items.length() == 0) {
            call.resolve(JSObject().put("written", 0).put("failed", JSArray()))
            return
        }
        val uris = (0 until items.length()).map { Uri.parse(items.getJSONObject(it).optString("uri")) }
        try {
            val launcher = writeLauncher ?: return call.reject("Запрос на запись недоступен")
            pendingWrite = call to then
            launcher.launch(IntentSenderRequest.Builder(MediaStore.createWriteRequest(context.contentResolver, uris).intentSender).build())
        } catch (e: Exception) {
            pendingWrite = null
            call.reject(e.message ?: e.toString())
        }
    }

    /**
     * Удаление файлов с телефона. Подтверждение показывает сам Android (MediaStore.createDeleteRequest),
     * без него приложение чужие файлы удалить не может. История прослушиваний и оценки остаются:
     * трек помечается пропавшим (missing_since) и уходит из медиатеки.
     */
    @PluginMethod
    fun deleteFiles(call: PluginCall) {
        val items = call.getArray("items") ?: JSArray()
        if (items.length() == 0) return call.resolve(JSObject().put("deleted", 0))
        val uris = (0 until items.length()).map { Uri.parse(items.getJSONObject(it).optString("uri")) }
        val keys = (0 until items.length()).map { items.getJSONObject(it).optString("key") }
        try {
            val launcher = writeLauncher ?: return call.reject("Запрос на удаление недоступен")
            pendingWrite = call to { ok ->
                if (!ok) {
                    call.reject("Удаление отменено", "CANCELLED")
                } else {
                    work.execute {
                        val now = System.currentTimeMillis()
                        for (k in keys) Database.execute("UPDATE tracks SET missing_since = ? WHERE key = ?", listOf(now, k))
                        call.resolve(JSObject().put("deleted", keys.size))
                    }
                }
            }
            launcher.launch(IntentSenderRequest.Builder(MediaStore.createDeleteRequest(context.contentResolver, uris).intentSender).build())
        } catch (e: Exception) {
            pendingWrite = null
            call.reject(e.message ?: e.toString())
        }
    }

    private fun onWritePermission(res: ActivityResult) {
        val (_, then) = pendingWrite ?: return
        pendingWrite = null
        then(res.resultCode == Activity.RESULT_OK)
    }

    /** Действие над каждым файлом: обновить строку в базе, отдать MediaStore на пересканирование */
    private fun runOnFiles(items: JSONArray, action: (Uri, String, JSONObject) -> TagFiles.Result): JSObject {
        var written = 0
        val failed = JSArray()
        val paths = ArrayList<String>()
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val key = it.optString("key")
            try {
                val uri = Uri.parse(it.optString("uri"))
                val r = action(uri, key, it)
                if (!r.ok) {
                    failed.put(JSONObject().put("key", key).put("reason", r.reason ?: "ошибка"))
                    continue
                }
                val e = editOf(it)
                Database.execute(
                    """UPDATE tracks SET title = COALESCE(?, title), artist = COALESCE(?, artist), album = COALESCE(?, album),
                       genre = COALESCE(?, genre), year = COALESCE(?, year), track_no = COALESCE(?, track_no),
                       size = ?, updated_at = ? WHERE key = ?""",
                    listOf(e.title, e.artist, e.album, e.genre, e.year, e.trackNo, r.size, System.currentTimeMillis(), key),
                )
                // Новая обложка уже в файле: показываем её сразу, не дожидаясь пересканирования
                e.picture?.let { pic ->
                    Covers.save(context, pic)?.let { c ->
                        Database.execute(
                            "UPDATE tracks SET art = ?, color1 = COALESCE(?, color1), color2 = COALESCE(?, color2) WHERE key = ?",
                            listOf(c.hash, c.color1, c.color2, key),
                        )
                        Database.execute("UPDATE track_user SET custom_art = NULL WHERE key = ?", listOf(key))
                    }
                }
                it.optString("path").takeIf { p -> p.isNotEmpty() }?.let(paths::add)
                // Отпечаток сменился (MP4 теперь по аудиоданным): история, оценки и плейлисты переезжают следом
                r.newKey?.let { nk -> if (nk != key) KeyAliases.add(key, nk) }
                written++
            } catch (e: Exception) {
                failed.put(JSONObject().put("key", key).put("reason", e.message ?: "ошибка"))
            }
        }
        KeyAliases.fixup()
        PlayerHub.remapKeys(KeyAliases.map())
        if (paths.isNotEmpty()) {
            // Ждём, пока Android перечитает файлы: иначе следующее сканирование библиотеки увидит старые данные
            val done = java.util.concurrent.CountDownLatch(paths.size)
            MediaScannerConnection.scanFile(context, paths.toTypedArray(), null) { _, _ -> done.countDown() }
            done.await(8, java.util.concurrent.TimeUnit.SECONDS)
        }
        return JSObject().put("written", written).put("failed", failed)
    }

    /* ---------------- воспроизведение ---------------- */

    @PluginMethod
    fun configure(call: PluginCall) {
        val c = call.getObject("counting")
        if (c != null) {
            PlayerHub.tracker.rule = PlayTracker.Rule(
                minTrackMs = c.optLong("minTrackMs", 30_000),
                minFraction = c.optDouble("minFraction", 0.5),
                minListenMs = c.optLong("minListenMs", 240_000),
            )
        }
        call.resolve()
    }

    @PluginMethod
    fun setAudioSettings(call: PluginCall) = onMain(call) {
        PlayerHub.setAudioSettings(call.data)
        call.resolve()
    }

    @PluginMethod
    fun setQueue(call: PluginCall) = onMain(call) {
        val items = PlayerHub.parseItems(call.getArray("items"))
        val rev = PlayerHub.setQueue(
            items,
            call.getInt("index", 0) ?: 0,
            call.data.optLong("positionMs", 0),
            call.getBoolean("play", true) ?: true,
        )
        call.resolve(JSObject().put("rev", rev))
    }

    @PluginMethod
    fun editQueue(call: PluginCall) = onMain(call) {
        val rev = PlayerHub.editQueue(call.getArray("edits") ?: JSArray())
        call.resolve(JSObject().put("rev", rev))
    }

    @PluginMethod
    fun skipTo(call: PluginCall) = onMain(call) {
        PlayerHub.skipTo(call.getInt("index", 0) ?: 0, call.getBoolean("play", true) ?: true)
        call.resolve()
    }

    @PluginMethod
    fun control(call: PluginCall) = onMain(call) {
        preview?.stop()
        PlayerHub.control(call.getString("action") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun seekTo(call: PluginCall) = onMain(call) {
        PlayerHub.seekTo(call.data.optLong("positionMs", 0))
        call.resolve()
    }

    @PluginMethod
    fun setRepeat(call: PluginCall) = onMain(call) {
        PlayerHub.setRepeat(call.getString("mode") ?: "off")
        call.resolve()
    }

    @PluginMethod
    fun getState(call: PluginCall) = onMain(call) {
        call.resolve(JSObject.fromJSONObject(PlayerHub.snapshotJson()))
    }

    @PluginMethod
    fun setFavoriteState(call: PluginCall) = onMain(call) {
        PlayerHub.setFavoriteState(call.getString("key") ?: "", call.getBoolean("value", false) ?: false)
        call.resolve()
    }

    @PluginMethod
    fun setSleepTimer(call: PluginCall) = onMain(call) {
        PlayerHub.setSleepTimer(call.getInt("minutes", 0) ?: 0, call.getBoolean("endOfTrack", false) ?: false)
        call.resolve()
    }

    @PluginMethod
    fun setAbLoop(call: PluginCall) = onMain(call) {
        PlayerHub.setAbLoop(call.data.optLong("startMs", -1), call.data.optLong("endMs", -1))
        call.resolve()
    }

    @PluginMethod
    fun setPlaybackParams(call: PluginCall) = onMain(call) {
        PlayerHub.setPlaybackParams(call.data.optDouble("speed", 1.0).toFloat(), call.data.optDouble("pitch", 1.0).toFloat())
        call.resolve()
    }

    @PluginMethod
    fun setEffects(call: PluginCall) = onMain(call) {
        PlayerHub.setEffects(call.data.optJSONObject("effects") ?: JSONObject())
        call.resolve()
    }

    /* ---------------- вывод звука ---------------- */

    @PluginMethod
    fun getOutputs(call: PluginCall) = onMain(call) {
        call.resolve(JSObject.fromJSONObject(PlayerHub.outputsJson()))
    }

    @PluginMethod
    fun setOutput(call: PluginCall) = onMain(call) {
        val id = if (call.data.has("deviceId") && !call.data.isNull("deviceId")) call.data.optInt("deviceId") else null
        PlayerHub.setOutput(id)
        call.resolve()
    }

    @PluginMethod
    fun openSystemOutputSwitcher(call: PluginCall) = onMain(call) {
        var shown = false
        if (Build.VERSION.SDK_INT >= 34) {
            shown = try {
                android.media.MediaRouter2.getInstance(context).showSystemOutputSwitcher()
            } catch (_: Throwable) {
                false
            }
        }
        if (!shown) {
            context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        call.resolve()
    }

    /* ---------------- предпрослушивание ---------------- */

    private fun previewer(): Preview = preview ?: Preview(context) { notifyListeners("previewEnded", JSObject()) }.also { preview = it }

    @PluginMethod
    fun previewSnippet(call: PluginCall) = onMain(call) {
        PlayerHub.control("pause")
        previewer().snippet(
            call.getString("uri") ?: "",
            call.data.optLong("fromMs", 0),
            call.data.optLong("durationMs", 15_000),
            call.data.optDouble("gainDb", 0.0),
        )
        call.resolve()
    }

    @PluginMethod
    fun previewJunction(call: PluginCall) = onMain(call) {
        PlayerHub.control("pause")
        val d = call.data
        previewer().junction(
            d.optString("aUri"),
            d.optLong("atMs"),
            d.optString("bUri"),
            d.optLong("cueMs", 0),
            d.optString("type", "crossfade"),
            d.optLong("durationMs", 6000),
            d.optString("curve", "equalPower"),
            d.optDouble("duckDb", -9.0),
            d.optLong("leadMs", 8000),
            d.optLong("tailMs", 8000),
        )
        call.resolve()
    }

    @PluginMethod
    fun previewStop(call: PluginCall) = onMain(call) {
        preview?.stop()
        call.resolve()
    }

    /* ---------------- файлы бэкапа ---------------- */

    /** Содержимое экспортируемого файла, пока пользователь выбирает, куда его сохранить */
    private val exportStash get() = java.io.File(context.cacheDir, "export-pending.bin")

    @PluginMethod
    fun exportFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mime") ?: "application/json")
            .putExtra(Intent.EXTRA_TITLE, call.getString("name") ?: "amber-backup.json")
        // Данные не должны ехать вместе с вызовом: пока открыт системный выбор папки, Capacitor
        // кладёт вызов целиком в сохранённое состояние активности, а у Android там лимит ~1 МБ.
        // Бэкап с большой историей (десятки МБ) ронял приложение (TransactionTooLargeException).
        // Поэтому содержимое — во временный файл (переживёт и выгрузку процесса), в вызове только имя.
        try {
            val data = call.getString("data") ?: ""
            val bytes = if (call.getBoolean("base64", false) == true) {
                android.util.Base64.decode(data, android.util.Base64.DEFAULT)
            } else {
                data.toByteArray()
            }
            exportStash.writeBytes(bytes)
        } catch (e: Exception) {
            return call.reject(e.message ?: "Не удалось подготовить файл")
        }
        call.data.remove("data")
        startActivityForResult(call, intent, "onExportPicked")
    }

    @ActivityCallback
    private fun onExportPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            exportStash.delete()
            call.reject("Сохранение отменено", "CANCELLED")
            return
        }
        onWork(call) {
            val stash = exportStash
            if (!stash.exists()) error("Данные для сохранения потерялись, повтори экспорт")
            context.contentResolver.openOutputStream(uri, "wt")?.use { out -> stash.inputStream().use { it.copyTo(out) } }
                ?: error("Не удалось открыть файл для записи")
            stash.delete()
            call.resolve(JSObject().put("uri", uri.toString()))
        }
    }

    @PluginMethod
    fun importFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
        startActivityForResult(call, intent, "onImportPicked")
    }

    @ActivityCallback
    private fun onImportPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.reject("Выбор файла отменён", "CANCELLED")
            return
        }
        onWork(call) {
            val cr = context.contentResolver
            val name = cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            } ?: "backup.json"
            val text = cr.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: error("Не удалось прочитать файл")
            call.resolve(JSObject().put("name", name).put("data", text))
        }
    }

    /** Папка для автобэкапов: выбирается один раз, доступ к ней система запоминает */
    @PluginMethod
    fun chooseBackupFolder(call: PluginCall) {
        startActivityForResult(call, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "onBackupFolderPicked")
    }

    @ActivityCallback
    private fun onBackupFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.reject("Папка не выбрана", "CANCELLED")
            return
        }
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        call.resolve(JSObject().put("uri", uri.toString()))
    }

    /** JSON от интерфейса + копия базы в папку автобэкапа; старые копии удаляются */
    @PluginMethod
    fun writeBackup(call: PluginCall) = onWork(call) {
        val tree = Uri.parse(call.getString("folderUri") ?: error("Папка не задана"))
        val keep = call.getInt("keep", 14) ?: 14
        val stamp = SimpleDateFormat("yyyy-MM-dd_HHmm", Locale.US).format(Date())
        val json = Backups.write(context, tree, "amber-backup-$stamp.json", "application/json", (call.getString("json") ?: "").toByteArray())
        Backups.prune(context, tree, "amber-backup-", keep)
        val db = Backups.snapshotDb(context)
        Backups.write(context, tree, "amber-db-$stamp.sqlite", "application/octet-stream", db.readBytes())
        db.delete()
        Backups.prune(context, tree, "amber-db-", minOf(keep, 7))
        call.resolve(JSObject().put("uri", json.toString()))
    }
}
