package app.yantar.player.online

import app.yantar.player.core.Lang
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Запросы окна приложения к компьютеру в домашней сети (общие данные по Wi-Fi, desktop/hub.ts).
 *
 * Окно открыто по https://localhost, а компьютер отвечает по обычному http (192.168.…): WebView такой запрос
 * не пропустит, и правильно. Поэтому их делает Kotlin, как и запросы папки по Wi-Fi (FileSync), а окно получает
 * ответ целиком (lanRequest) или события потока по одному (lanEventsOpen → события lanEvent / lanEventsClosed).
 */
object LanHttp {
    val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "amber-lan").apply { isDaemon = true } }

    class Response(val status: Int, val body: String, val contentType: String?)

    fun request(method: String, url: String, headers: JSONObject?, body: String?, timeoutMs: Int): Response {
        val c = LocalNet.open(URL(url)).apply {
            requestMethod = method
            connectTimeout = minOf(15_000, timeoutMs)
            readTimeout = timeoutMs
            useCaches = false
            headers?.keys()?.forEach { k -> setRequestProperty(k, headers.getString(k)) }
            // Ошибки компьютер пишет на языке телефона
            setRequestProperty("Accept-Language", Lang.tag)
        }
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Response(code, text, c.contentType)
        } finally {
            c.disconnect()
        }
    }

    private val streams = ConcurrentHashMap<String, HttpURLConnection>()

    /**
     * Поток событий (SSE). onEvent — на каждое событие, onClose — один раз в конце:
     * status — код ответа (null — не дозвонились), error — что случилось
     */
    fun open(
        id: String,
        url: String,
        token: String,
        onEvent: (name: String, data: String) -> Unit,
        onClose: (status: Int?, contentType: String?, error: String?) -> Unit,
    ) {
        io.execute {
            var status: Int? = null
            var type: String? = null
            var error: String? = null
            try {
                val c = LocalNet.open(URL(url)).apply {
                    connectTimeout = 15_000
                    // Компьютер подаёт голос раз в 25 с: дольше тишины — связь умерла
                    readTimeout = 70_000
                    useCaches = false
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("Accept", "text/event-stream")
                    setRequestProperty("Accept-Language", Lang.tag)
                }
                streams[id] = c
                status = c.responseCode
                type = c.contentType
                if (status == 200 && type?.contains("text/event-stream") == true) {
                    c.inputStream.bufferedReader(Charsets.UTF_8).use { r ->
                        var name = ""
                        val data = StringBuilder()
                        while (streams.containsKey(id)) {
                            val line = r.readLine() ?: break
                            when {
                                line.startsWith("event:") -> name = line.substring(6).trim()
                                line.startsWith("data:") -> data.append(line.substring(5).trim())
                                line.isEmpty() && name.isNotEmpty() -> {
                                    onEvent(name, data.toString())
                                    name = ""
                                    data.setLength(0)
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            } finally {
                streams.remove(id)?.disconnect()
                onClose(status, type, error)
            }
        }
    }

    fun close(id: String) {
        val c = streams.remove(id) ?: return
        io.execute { runCatching { c.disconnect() } }
    }
}
