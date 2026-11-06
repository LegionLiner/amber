package app.yantar.player.online

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL

/**
 * Связь с компьютером в домашней сети мимо VPN.
 *
 * Когда на телефоне включён VPN, Android по умолчанию отправляет в туннель всё, даже запросы к 192.168.… —
 * до компьютера в той же Wi-Fi-сети они не доходят. Поэтому запросы на адреса домашней сети открываются через
 * саму сеть Wi-Fi (Network.openConnection). Многие VPN это разрешают (allowBypass); если VPN запрещает — Android
 * не даст привязаться к Wi-Fi, и запрос идёт обычным путём, как раньше (тогда поможет «доступ к локальной сети»
 * или исключение Amber в настройках самого VPN — об этом подскажут настройки).
 */
object LocalNet {
    private var app: Context? = null

    fun init(ctx: Context) {
        app = ctx.applicationContext
    }

    private fun cm(): ConnectivityManager? = app?.getSystemService(ConnectivityManager::class.java)

    /** Сеть Wi-Fi (или проводная), в которой стоит телефон, — не VPN */
    private fun lanNetwork(): Network? {
        val cm = cm() ?: return null
        @Suppress("DEPRECATION")
        return cm.allNetworks.firstOrNull { n ->
            val c = cm.getNetworkCapabilities(n) ?: return@firstOrNull false
            !c.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        }
    }

    /** Включён ли VPN — чтобы подсказать, что делать, если компьютер не отвечает */
    fun vpnActive(): Boolean {
        val cm = cm() ?: return false
        @Suppress("DEPRECATION")
        return cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }

    /** Адрес домашней сети: 10.*, 172.16–31.*, 192.168.*, 169.254.* (по буквам, без DNS) */
    fun isLocal(host: String): Boolean {
        val h = host.trim('[', ']')
        if (!h.matches(Regex("""\d{1,3}(\.\d{1,3}){3}"""))) return false
        val a = runCatching { InetAddress.getByName(h) }.getOrNull() as? Inet4Address ?: return false
        return a.isSiteLocalAddress || a.isLinkLocalAddress
    }

    /**
     * Соединение к url: в домашнюю сеть — через Wi-Fi, мимо VPN. Не вышло привязаться к Wi-Fi (VPN не разрешает,
     * Wi-Fi нет) — обычное соединение
     */
    fun open(url: URL): HttpURLConnection {
        if (isLocal(url.host)) {
            val net = bypassable()
            if (net != null) runCatching { return net.openConnection(url) as HttpURLConnection }
        }
        return url.openConnection() as HttpURLConnection
    }

    /** UDP-сокет маячков — тоже к Wi-Fi (если VPN не против) */
    fun bind(sock: DatagramSocket) {
        val net = bypassable() ?: return
        runCatching { net.bindSocket(sock) }
    }

    /**
     * Сеть Wi-Fi, если к ней можно привязаться. VPN без allowBypass не даёт (EPERM), но openConnection узнаёт об этом
     * только при соединении — поэтому пробуем привязать пустой сокет и запоминаем ответ для этой сети
     */
    @Volatile private var checked: Pair<String, Boolean>? = null

    private fun bypassable(): Network? {
        val net = lanNetwork() ?: return null
        // VPN включили или выключили в той же сети — проверяем заново
        val key = "$net|${vpnActive()}"
        checked?.let { (k, ok) -> if (k == key) return if (ok) net else null }
        val ok = runCatching { java.net.Socket().use { net.bindSocket(it) } }.isSuccess
        checked = key to ok
        return if (ok) net else null
    }
}
