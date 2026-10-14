package app.yantar.player.online

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import app.yantar.player.db.Database
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Связь движка телефона с другими устройствами аккаунта через сервер синхронизации (server/src/live.ts).
 *
 * Интерфейс приложения держит свой поток событий, пока он открыт (src/stores/sync.ts). Но слушают музыку
 * чаще с погашенным экраном — поэтому у звукового движка свой поток (role=engine), и он живёт вместе со службой
 * воспроизведения:
 *  - что играет (трек, пауза, место, окно очереди) уходит на сервер (POST /v1/player) — компьютер это видит;
 *  - команды с других устройств (пауза, следующий, перемотка) приходят сюда и выполняются движком.
 *
 * Вид состояния — DeviceState из src/sync/live.ts. Вход (адрес сервера и токен) — из таблицы sync_state,
 * которую ведёт интерфейс; после входа и выхода он зовёт relink().
 *
 * Батарея: 10 минут после паузы поток закрывается (телефон пропадает из списка устройств на компьютере)
 * и открывается снова, как только музыка заиграла.
 */
object RemoteLink {
    private const val TAG = "RemoteLink"
    private const val IDLE_MS = 10 * 60_000L
    private const val READ_TIMEOUT_MS = 70_000
    private const val OLD_SERVER_RETRY_MS = 10 * 60_000L

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "amber-remote-io").apply { isDaemon = true } }
    private val waiter = Object()

    /** Что играет сейчас (вызывается на главном потоке); null — очередь пуста */
    var stateSource: (() -> JSONObject?)? = null

    /** Выполнить команду (на главном потоке) */
    var commandSink: ((cmd: String, args: JSONObject?) -> Unit)? = null

    @Volatile private var running = false
    @Volatile private var gen = 0
    @Volatile private var conn: HttpURLConnection? = null
    @Volatile private var connected = false
    @Volatile private var creds: Pair<String, String>? = null
    /** До какого момента поток нужен (elapsedRealtime): музыка играла недавно */
    @Volatile private var activeUntil = 0L

    private var lastSig = ""
    private var lastPos = 0L
    private var lastAt = 0L
    private var lastPlaying = false

    fun start() {
        if (running) return
        running = true
        spawn()
    }

    fun stop() {
        running = false
        gen++
        drop()
        wake()
    }

    /** Вход поменялся (вошли, вышли): переподключиться с новым токеном */
    fun relink() {
        if (!running) return
        gen++
        drop()
        spawn()
    }

    private fun drop() {
        connected = false
        val c = conn
        conn = null
        if (c != null) io.execute { runCatching { c.disconnect() } }
    }

    private fun wake() = synchronized(waiter) { waiter.notifyAll() }

    private fun nap(ms: Long) = synchronized(waiter) {
        try {
            waiter.wait(ms.coerceAtLeast(1))
        } catch (_: InterruptedException) {
        }
    }

    private fun spawn() {
        val my = gen
        Thread({ loop(my) }, "amber-remote").apply {
            isDaemon = true
            start()
        }
    }

    private fun readCreds(): Pair<String, String>? = try {
        val rows = Database.query("SELECT k, v FROM sync_state WHERE k IN ('url', 'token')", emptyList()).rows
        val m = rows.associate { it[0].toString() to it[1]?.toString() }
        val url = m["url"]?.trimEnd('/')
        val token = m["token"]
        if (url.isNullOrEmpty() || token.isNullOrEmpty()) null else url to token
    } catch (e: Exception) {
        null
    }

    private fun loop(my: Int) {
        var fails = 0
        while (running && my == gen) {
            if (SystemClock.elapsedRealtime() > activeUntil) {
                // Музыка давно на паузе: соединение не держим, ждём, пока заиграет
                nap(60_000)
                continue
            }
            val c0 = readCreds()
            if (c0 == null) {
                nap(60_000)
                continue
            }
            creds = c0
            var pause = 0L
            try {
                val c = (URL("${c0.first}/v1/events?role=engine").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15_000
                    readTimeout = READ_TIMEOUT_MS
                    setRequestProperty("Authorization", "Bearer ${c0.second}")
                    setRequestProperty("Accept", "text/event-stream")
                    useCaches = false
                }
                conn = c
                val code = c.responseCode
                when {
                    code == 401 -> pause = OLD_SERVER_RETRY_MS // вход отозвали: ждём relink() от интерфейса
                    code != 200 || c.contentType?.contains("text/event-stream") != true -> pause = OLD_SERVER_RETRY_MS
                    else -> c.inputStream.bufferedReader().use { r ->
                        var name = ""
                        val data = StringBuilder()
                        while (running && my == gen) {
                            val line = r.readLine() ?: break
                            fails = 0
                            when {
                                line.startsWith("event:") -> name = line.substring(6).trim()
                                line.startsWith("data:") -> data.append(line.substring(5).trim())
                                line.isEmpty() && name.isNotEmpty() -> {
                                    handle(name, data.toString())
                                    name = ""
                                    data.setLength(0)
                                }
                            }
                            // Музыка давно стоит — отпускаем соединение (сердцебиение сервера приходит раз в 25 с)
                            if (SystemClock.elapsedRealtime() > activeUntil) break
                        }
                    }
                }
            } catch (e: Exception) {
                if (running && my == gen) Log.d(TAG, "поток событий оборвался: ${e.message}")
            } finally {
                connected = false
                runCatching { conn?.disconnect() }
                conn = null
            }
            if (!running || my != gen) break
            fails++
            nap(if (pause > 0) pause else minOf(30_000L, 1000L shl minOf(fails - 1, 5)))
        }
    }

    private fun handle(name: String, data: String) {
        when (name) {
            "hello" -> {
                connected = true
                main.post {
                    lastSig = ""
                    publish(true)
                }
            }
            "command" -> {
                val j = runCatching { JSONObject(data) }.getOrNull() ?: return
                val cmd = j.optString("cmd")
                val args = j.optJSONObject("args")
                main.post { commandSink?.invoke(cmd, args) }
            }
        }
    }

    /* ------------------------------ что играет ------------------------------ */

    private val publishTask = Runnable { publish(false) }
    private val heartbeat = object : Runnable {
        override fun run() {
            publish(false)
            if (lastPlaying) main.postDelayed(this, 30_000)
        }
    }

    /** Состояние плеера поменялось (зовёт PlayerHub на любое событие) */
    fun stateChanged(playing: Boolean) {
        if (playing) {
            val wasIdle = SystemClock.elapsedRealtime() > activeUntil
            activeUntil = SystemClock.elapsedRealtime() + IDLE_MS
            if (wasIdle) wake()
        }
        if (!running) return
        main.removeCallbacks(publishTask)
        main.postDelayed(publishTask, 300)
    }

    private fun publish(force: Boolean) {
        if (!connected) return
        val s = stateSource?.invoke()
        val sig = s?.let {
            "${it.optString("key")}|${it.optBoolean("playing")}|${it.optInt("index")}|${it.optJSONArray("queue")?.length()}|${it.optInt("rev")}|${it.optString("repeat")}"
        } ?: "none"
        val now = SystemClock.elapsedRealtime()
        val pos = s?.optLong("positionMs") ?: 0L
        val playing = s?.optBoolean("playing") == true
        if (!force && sig == lastSig) {
            if (s == null) return
            val expected = lastPos + if (lastPlaying) now - lastAt else 0L
            // Перемотали — отправляем; иначе только раз в полминуты, сверить ход
            if (abs(expected - pos) < 2000 && now - lastAt < 30_000) return
        }
        lastSig = sig
        lastPos = pos
        lastAt = now
        val wasPlaying = lastPlaying
        lastPlaying = playing
        if (playing && !wasPlaying) {
            main.removeCallbacks(heartbeat)
            main.postDelayed(heartbeat, 30_000)
        }
        s?.remove("rev")
        val c = creds ?: return
        io.execute {
            // Позиция — на момент отправки, а не на момент, когда её сняли
            if (s != null && playing) s.put("positionMs", pos + (SystemClock.elapsedRealtime() - now))
            val ok = post(c, "/v1/player", JSONObject().put("state", s ?: JSONObject.NULL))
            if (!ok) main.post { lastSig = "" }
        }
    }

    private fun post(c: Pair<String, String>, path: String, body: JSONObject): Boolean = try {
        val h = (URL("${c.first}$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer ${c.second}")
            setRequestProperty("Content-Type", "application/json")
        }
        h.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = h.responseCode
        runCatching { (if (code < 400) h.inputStream else h.errorStream)?.close() }
        h.disconnect()
        code in 200..299
    } catch (e: Exception) {
        Log.d(TAG, "не отправилось: ${e.message}")
        false
    }
}
