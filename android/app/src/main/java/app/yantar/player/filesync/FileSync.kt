package app.yantar.player.filesync

import app.yantar.player.core.Lang
import android.content.Context
import android.media.MediaScannerConnection
import android.net.wifi.WifiManager
import org.json.JSONArray
import org.json.JSONObject
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
 * Папка телефона — выбранная один раз системным окном (SafFolder): Android помнит разрешение на неё, доступ
 * «ко всем файлам» не нужен. Время изменения через SAF не задать — после скачивания запоминается то, какое есть.
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

    fun stat(j: JSONObject?): Stat? = j?.let { Stat(it.optLong("s"), it.optLong("m")) }

    private fun matches(root: SafFolder, p: String, expect: Stat?): Boolean {
        val e = root.entry(p)
        return if (expect == null) e == null else e != null && !e.dir && e.size == expect.s && abs(e.mtime - expect.m) < 1000
    }

    /** То же правило, что ignored() в plan.ts: скрытое, служебное, недокачанное */
    fun ignored(p: String): Boolean {
        val parts = p.split('/')
        val name = parts.last().lowercase()
        return parts.any { it.isEmpty() || it.startsWith(".") } ||
            name == "desktop.ini" || name == "thumbs.db" || name.endsWith(".amber-part") || name.endsWith(".tmp")
    }

    /** Путь из плана: только внутри папки — без «..», пустых частей и обратных косых */
    fun checkPath(p: String): String {
        require(p.isNotEmpty() && !p.contains('\\') && p.split('/').none { it == ".." || it == "." || it.isEmpty() }) { Lang.t("Недопустимый путь", "Invalid path") }
        return p
    }

    /* ------------------------------ эта сторона ------------------------------ */

    fun listLocal(root: SafFolder): JSONArray {
        val out = JSONArray()
        fun walk(rel: String) {
            for (e in root.children(rel)) {
                val p = if (rel.isEmpty()) e.name else "$rel/${e.name}"
                if (ignored(p)) continue
                if (e.dir) walk(p) else out.put(JSONObject().put("p", p).put("s", e.size).put("m", e.mtime))
            }
        }
        walk("")
        return out
    }

    fun hashFile(root: SafFolder, p: String): String {
        val md = MessageDigest.getInstance("SHA-1")
        root.read(p).use { input ->
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
    fun moveToTrash(ctx: Context, root: SafFolder, p: String) {
        if (!root.exists("$TRASH/.nomedia")) {
            root.ensureDir(TRASH)
            root.write(root.create("$TRASH/.nomedia")).close()
        }
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val dir = SafFolder.parentOf(p).let { if (it.isEmpty()) "$TRASH/$day" else "$TRASH/$day/$it" }
        root.ensureDir(dir)
        val name = p.substringAfterLast('/')
        var src = p
        // Та же версия уже в корзине сегодня — рядом с отметкой времени, ничего не затираем
        if (root.exists("$dir/$name")) {
            val stamped = "${System.currentTimeMillis()}-$name"
            if (!root.rename(p, stamped)) throw IOException(Lang.t("Не удалось убрать «$name» в корзину", "Couldn't move “$name” to the trash"))
            src = SafFolder.parentOf(p).let { if (it.isEmpty()) stamped else "$it/$stamped" }
        }
        if (!root.move(src, dir)) throw IOException(Lang.t("Не удалось убрать «$name» в корзину", "Couldn't move “$name” to the trash"))
        scan(ctx, root, p)
    }

    fun trashLocal(ctx: Context, root: SafFolder, p: String, expect: Stat?): String {
        checkPath(p)
        if (!root.exists(p)) return "missing"
        if (expect == null || !matches(root, p, expect)) return "changed"
        moveToTrash(ctx, root, p)
        return "ok"
    }

    /** Корзина старше days дней удаляется насовсем */
    fun cleanTrash(root: SafFolder, days: Int) {
        if (!root.exists(TRASH)) return
        val cutoff = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(System.currentTimeMillis() - days * 86_400_000L))
        root.children(TRASH).filter { it.dir && it.name < cutoff && it.name.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) }
            .forEach { root.delete("$TRASH/${it.name}") }
    }

    /** Медиатека телефона (MediaStore) узнаёт о новом, заменённом или убранном файле */
    private fun scan(ctx: Context, root: SafFolder, p: String) {
        val path = root.pathOf(p) ?: return
        MediaScannerConnection.scanFile(ctx, arrayOf(path), null, null)
    }

    /* ------------------------------ компьютер ------------------------------ */

    class HttpFail(val code: Int, val why: String?, message: String) : IOException(message)

    private fun open(base: String, path: String, token: String?, method: String = "GET", readMs: Int = 60_000): HttpURLConnection =
        app.yantar.player.online.LocalNet.open(URL("$base$API$path")).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = readMs
            useCaches = false
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept-Language", Lang.tag)
        }

    private fun readBody(c: HttpURLConnection): String {
        val s = (if (c.responseCode < 400) c.inputStream else c.errorStream)
        return s?.bufferedReader()?.use { it.readText() } ?: ""
    }

    private fun jsonOrFail(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val body = readBody(c)
        val j = runCatching { JSONObject(body) }.getOrNull() ?: JSONObject()
        if (code !in 200..299) throw HttpFail(code, j.optString("why").ifEmpty { null }, j.optString("error").ifEmpty { Lang.t("Компьютер ответил $code", "The computer responded $code") })
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
    fun pull(ctx: Context, base: String, token: String, root: SafFolder, rp: String, lp: String, from: Stat, expect: Stat?): JSONObject {
        checkPath(lp)
        if (!matches(root, lp, expect)) return fail("changed")
        val c = open(base, "/file?p=${q(rp)}", token, readMs = 120_000)
        val name = lp.substringAfterLast('/')
        val dir = SafFolder.parentOf(lp)
        val partP = (if (dir.isEmpty()) "" else "$dir/") + ".$name.amber-part"
        var part = false
        try {
            if (c.responseCode == 404) return fail("changed")
            if (c.responseCode != 200) {
                val j = runCatching { JSONObject(readBody(c)) }.getOrNull()
                return fail(j?.optString("why")?.ifEmpty { null } ?: "error", j?.optString("error"))
            }
            val r = Stat(c.getHeaderField("X-Size")?.toLongOrNull() ?: -1, c.getHeaderField("X-Mtime")?.toLongOrNull() ?: -1)
            if (r.s != from.s || abs(r.m - from.m) >= 1000) return fail("changed")
            // Недокачанный хвост прошлого раза — иначе Android назовёт новый «… (1)»
            if (root.exists(partP)) root.delete(partP)
            val u = root.create(partP)
            part = true
            c.inputStream.use { input -> root.write(u).use { input.copyTo(it, 1 shl 16) } }
            if (root.stat(partP)?.s != from.s) return fail("error", Lang.t("Файл пришёл не целиком", "The file arrived incomplete"))
            // Пока качали, файл здесь могли поменять
            if (!matches(root, lp, expect)) return fail("changed")
            if (expect != null) moveToTrash(ctx, root, lp)
            if (!root.rename(partP, name)) return fail("error", Lang.t("Не удалось сохранить «$name»", "Couldn't save “$name”"))
            part = false
            scan(ctx, root, lp)
            // Время файла через SAF не задать — запоминаем, какое у него теперь
            val l = root.stat(lp) ?: return fail("error", Lang.t("Не удалось сохранить «$name»", "Couldn't save “$name”"))
            return JSONObject().put("ok", true).put("l", l.json()).put("r", r.json())
        } catch (e: SocketTimeoutException) {
            return fail("error", Lang.t("Компьютер не отвечает", "The computer doesn't respond"))
        } finally {
            if (part) root.delete(partP)
            c.disconnect()
        }
    }

    /** Отправить lp на компьютер как rp */
    fun push(base: String, token: String, root: SafFolder, lp: String, rp: String, from: Stat, expect: Stat?): JSONObject {
        checkPath(lp)
        if (!matches(root, lp, from)) return fail("changed")
        val c = open(base, "/file?p=${q(rp)}&s=${from.s}&m=${from.m}&expect=${expectParam(expect)}", token, "PUT", 120_000)
        try {
            c.doOutput = true
            c.setFixedLengthStreamingMode(from.s)
            c.setRequestProperty("Content-Type", "application/octet-stream")
            root.read(lp).use { input -> c.outputStream.use { input.copyTo(it, 1 shl 16) } }
            val code = c.responseCode
            val j = runCatching { JSONObject(readBody(c)) }.getOrNull() ?: JSONObject()
            if (code == 200) return JSONObject().put("ok", true).put("l", from.json()).put("r", Stat(j.optLong("s"), j.optLong("m")).json())
            return fail(j.optString("why").ifEmpty { "error" }, j.optString("error").ifEmpty { Lang.t("Компьютер ответил $code", "The computer responded $code") })
        } catch (e: SocketTimeoutException) {
            return fail("error", Lang.t("Компьютер не отвечает", "The computer doesn't respond"))
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
                // При включённом VPN — слушать именно Wi-Fi
                app.yantar.player.online.LocalNet.bind(sock)
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
