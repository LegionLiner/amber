package app.yantar.player.filesync

import android.content.Context
import android.media.MediaScannerConnection
import android.net.wifi.WifiManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Папка с музыкой по Wi-Fi: телефонная половина. Что копировать, решает интерфейс (src/filesync/plan.ts,
 * run.ts) — здесь только надёжные действия с файлами и запросы к компьютеру (desktop/filesync.ts).
 *
 * Чтобы ничего не терялось:
 *  - скачанное пишется рядом во временный файл (.имя.amber-part), сверяется размер, и только потом встаёт
 *    на место; прежняя версия уходит в корзину папки (.amber-trash/дата/путь, там .nomedia — плеер её не видит);
 *  - перед заменой, отправкой и удалением файл сверяется с тем, каким его видел план (expect): поменяли —
 *    ничего не делаем, разберётся следующий проход;
 *  - корзина чистится через 30 дней.
 *
 * Работает с обычными путями (java.io.File): нужен доступ «ко всем файлам» (MANAGE_EXTERNAL_STORAGE).
 */
object FileSync {
    const val BEACON_PORT = 47863
    private const val API = "/amber-sync/v1"
    const val TRASH = ".amber-trash"

    /** Передачи — по одной, в своём потоке: сканер и плеер не ждут */
    val io = Executors.newSingleThreadExecutor { r -> Thread(r, "amber-filesync").apply { isDaemon = true } }

    class Stat(val s: Long, val m: Long) {
        fun json(): JSONObject = JSONObject().put("s", s).put("m", m)
    }

    fun statOf(f: File): Stat? = if (f.isFile) Stat(f.length(), f.lastModified()) else null

    fun stat(j: JSONObject?): Stat? = j?.let { Stat(it.optLong("s"), it.optLong("m")) }

    private fun matches(f: File, expect: Stat?): Boolean {
        val st = statOf(f)
        return if (expect == null) st == null && !f.exists() else st != null && st.s == expect.s && abs(st.m - expect.m) < 1000
    }

    /** То же правило, что ignored() в plan.ts: скрытое, служебное, недокачанное */
    fun ignored(p: String): Boolean {
        val parts = p.split('/')
        val name = parts.last().lowercase()
        return parts.any { it.isEmpty() || it.startsWith(".") } ||
            name == "desktop.ini" || name == "thumbs.db" || name.endsWith(".amber-part") || name.endsWith(".tmp")
    }

    /** Путь из плана → файл внутри корня. Выйти за пределы папки нельзя */
    fun resolve(root: File, p: String): File {
        require(p.isNotEmpty() && !p.contains('\\') && p.split('/').none { it == ".." || it.isEmpty() }) { "Недопустимый путь" }
        val f = File(root, p)
        require(f.canonicalPath.startsWith(root.canonicalPath + File.separator)) { "Недопустимый путь" }
        return f
    }

    /* ------------------------------ эта сторона ------------------------------ */

    fun listLocal(root: File): JSONArray {
        val out = JSONArray()
        fun walk(dir: File, rel: String) {
            val items = dir.listFiles() ?: return
            for (f in items) {
                val p = if (rel.isEmpty()) f.name else "$rel/${f.name}"
                if (ignored(p)) continue
                if (f.isDirectory) walk(f, p)
                else if (f.isFile) out.put(JSONObject().put("p", p).put("s", f.length()).put("m", f.lastModified()))
            }
        }
        require(root.isDirectory) { "Папки ${root.path} нет" }
        walk(root, "")
        return out
    }

    fun hashFile(f: File): String {
        val md = MessageDigest.getInstance("SHA-1")
        f.inputStream().use { input ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** В корзину папки: .amber-trash/2026-10-14/путь (с .nomedia, чтобы медиатека её не видела) */
    fun moveToTrash(ctx: Context, root: File, f: File) {
        val trash = File(root, TRASH)
        if (!trash.isDirectory) trash.mkdirs()
        File(trash, ".nomedia").let { if (!it.exists()) it.createNewFile() }
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val rel = f.canonicalPath.removePrefix(root.canonicalPath + File.separator)
        var target = File(File(trash, day), rel)
        // Та же версия уже в корзине сегодня — рядом с отметкой времени, ничего не затираем
        if (target.exists()) target = File(target.parentFile, "${System.currentTimeMillis()}-${target.name}")
        target.parentFile?.mkdirs()
        if (!f.renameTo(target)) throw IOException("Не удалось убрать «${f.name}» в корзину")
        scan(ctx, f)
    }

    fun trashLocal(ctx: Context, root: File, p: String, expect: Stat?): String {
        val f = resolve(root, p)
        if (!f.exists()) return "missing"
        if (expect == null || !matches(f, expect)) return "changed"
        moveToTrash(ctx, root, f)
        return "ok"
    }

    /** Корзина старше days дней удаляется насовсем */
    fun cleanTrash(root: File, days: Int) {
        val trash = File(root, TRASH)
        val cutoff = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(System.currentTimeMillis() - days * 86_400_000L))
        trash.listFiles()?.filter { it.isDirectory && it.name < cutoff && it.name.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) }
            ?.forEach { it.deleteRecursively() }
    }

    /** Медиатека телефона (MediaStore) узнаёт о новом, заменённом или убранном файле */
    private fun scan(ctx: Context, f: File) {
        MediaScannerConnection.scanFile(ctx, arrayOf(f.absolutePath), null, null)
    }

    /* ------------------------------ компьютер ------------------------------ */

    class HttpFail(val code: Int, val why: String?, message: String) : IOException(message)

    private fun open(base: String, path: String, token: String?, method: String = "GET", readMs: Int = 60_000): HttpURLConnection =
        (URL("$base$API$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = readMs
            useCaches = false
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }

    private fun readBody(c: HttpURLConnection): String {
        val s = (if (c.responseCode < 400) c.inputStream else c.errorStream)
        return s?.bufferedReader()?.use { it.readText() } ?: ""
    }

    private fun jsonOrFail(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val body = readBody(c)
        val j = runCatching { JSONObject(body) }.getOrNull() ?: JSONObject()
        if (code !in 200..299) throw HttpFail(code, j.optString("why").ifEmpty { null }, j.optString("error").ifEmpty { "Компьютер ответил $code" })
        return j
    }

    fun request(base: String, path: String, token: String?, method: String = "GET", body: JSONObject? = null, readMs: Int = 60_000): JSONObject {
        val c = open(base, path, token, method, readMs)
        try {
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            return jsonOrFail(c)
        } finally {
            c.disconnect()
        }
    }

    private fun q(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    private fun expectParam(e: Stat?) = if (e == null) "none" else "${e.s}:${e.m}"

    private fun fail(why: String, message: String? = null) = JSONObject().put("ok", false).put("why", why).apply { message?.let { put("message", it) } }

    /** Скачать rp в lp. from — каким файл был в списке компьютера, expect — каким сейчас должен быть lp */
    fun pull(ctx: Context, base: String, token: String, root: File, rp: String, lp: String, from: Stat, expect: Stat?): JSONObject {
        val target = resolve(root, lp)
        if (!matches(target, expect)) return fail("changed")
        val c = open(base, "/file?p=${q(rp)}", token, readMs = 120_000)
        var part: File? = null
        try {
            if (c.responseCode == 404) return fail("changed")
            if (c.responseCode != 200) {
                val j = runCatching { JSONObject(readBody(c)) }.getOrNull()
                return fail(j?.optString("why")?.ifEmpty { null } ?: "error", j?.optString("error"))
            }
            val r = Stat(c.getHeaderField("X-Size")?.toLongOrNull() ?: -1, c.getHeaderField("X-Mtime")?.toLongOrNull() ?: -1)
            if (r.s != from.s || abs(r.m - from.m) >= 1000) return fail("changed")
            target.parentFile?.mkdirs()
            part = File(target.parentFile, ".${target.name}.amber-part")
            c.inputStream.use { input -> part.outputStream().use { input.copyTo(it, 1 shl 16) } }
            if (part.length() != from.s) return fail("error", "Файл пришёл не целиком")
            // Пока качали, файл здесь могли поменять
            if (!matches(target, expect)) return fail("changed")
            if (expect != null) moveToTrash(ctx, root, target)
            if (!part.renameTo(target)) return fail("error", "Не удалось сохранить «${target.name}»")
            part = null
            // Время файла — как на компьютере (не везде получается: тогда запоминаем, какое есть)
            target.setLastModified(from.m)
            scan(ctx, target)
            return JSONObject().put("ok", true).put("l", statOf(target)!!.json()).put("r", r.json())
        } catch (e: SocketTimeoutException) {
            return fail("error", "Компьютер не отвечает")
        } finally {
            part?.delete()
            c.disconnect()
        }
    }

    /** Отправить lp на компьютер как rp */
    fun push(base: String, token: String, root: File, lp: String, rp: String, from: Stat, expect: Stat?): JSONObject {
        val f = resolve(root, lp)
        if (!matches(f, from)) return fail("changed")
        val c = open(base, "/file?p=${q(rp)}&s=${from.s}&m=${from.m}&expect=${expectParam(expect)}", token, "PUT", 120_000)
        try {
            c.doOutput = true
            c.setFixedLengthStreamingMode(f.length())
            c.setRequestProperty("Content-Type", "application/octet-stream")
            f.inputStream().use { input -> c.outputStream.use { input.copyTo(it, 1 shl 16) } }
            val code = c.responseCode
            val j = runCatching { JSONObject(readBody(c)) }.getOrNull() ?: JSONObject()
            if (code == 200) return JSONObject().put("ok", true).put("l", from.json()).put("r", Stat(j.optLong("s"), j.optLong("m")).json())
            return fail(j.optString("why").ifEmpty { "error" }, j.optString("error").ifEmpty { "Компьютер ответил $code" })
        } catch (e: SocketTimeoutException) {
            return fail("error", "Компьютер не отвечает")
        } finally {
            c.disconnect()
        }
    }

    fun trashRemote(base: String, token: String, p: String, expect: Stat?): String =
        request(base, "/trash", token, "POST", JSONObject().put("p", p).put("expect", expectParam(expect))).optString("result", "changed")

    /* ------------------------------ поиск компьютера ------------------------------ */

    /** Слушать маячки компьютеров в сети ms миллисекунд: [{host, port, id, name}] */
    fun discover(ctx: Context, ms: Int): JSONArray {
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java)
        // Без этого телефон в спящем Wi-Fi пропускает широковещательные пакеты
        val lock = wifi?.createMulticastLock("amber-filesync")?.apply {
            setReferenceCounted(false)
            acquire()
        }
        val found = LinkedHashMap<String, JSONObject>()
        try {
            DatagramSocket(null).use { sock ->
                sock.reuseAddress = true
                sock.broadcast = true
                sock.bind(InetSocketAddress(BEACON_PORT))
                val until = System.currentTimeMillis() + ms
                val buf = ByteArray(2048)
                while (System.currentTimeMillis() < until) {
                    sock.soTimeout = (until - System.currentTimeMillis()).coerceIn(1, 1000).toInt()
                    val pkt = DatagramPacket(buf, buf.size)
                    try {
                        sock.receive(pkt)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    val j = runCatching { JSONObject(String(pkt.data, 0, pkt.length)) }.getOrNull() ?: continue
                    if (j.optString("amber") != "filesync") continue
                    val id = j.optString("id")
                    found[id] = JSONObject()
                        .put("host", pkt.address.hostAddress)
                        .put("port", j.optInt("port"))
                        .put("id", id)
                        .put("name", j.optString("name"))
                }
            }
        } finally {
            lock?.release()
        }
        return JSONArray(found.values.toList())
    }
}
