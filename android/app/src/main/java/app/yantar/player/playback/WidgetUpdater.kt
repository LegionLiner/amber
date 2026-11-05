package app.yantar.player.playback

import app.yantar.player.core.Lang
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.SizeF
import android.view.KeyEvent
import android.widget.RemoteViews
import androidx.media3.session.MediaButtonReceiver
import app.yantar.player.R
import org.json.JSONObject
import java.io.File

/** Виджет на рабочий стол: обложка, трек и три кнопки. */
class PlayerWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetUpdater.update(context)
    }

    /** Размер поменяли: на Android 11 раскладку выбираем сами */
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        WidgetUpdater.update(context)
    }
}

/**
 * Пауза и переключение с виджета. MediaButtonReceiver из Media3 на Android 8+ пропускает только «играть»
 * (иначе служба может не успеть выйти на передний план), поэтому остальное управляет движком напрямую.
 * Если после переключения зазвучит музыка, служба поднимется сама (PlayerHub.ensureService).
 */
class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra("action") ?: return
        PlayerHub.init(context)
        PlayerHub.control(action)
        WidgetUpdater.request(context)
    }
}

/**
 * Обновляет все экземпляры виджета. «Играть» идёт через MediaButtonReceiver из Media3:
 * так кнопка работает и когда приложение выгружено (Media3 поднимет службу и продолжит).
 */
object WidgetUpdater {
    private val main = Handler(Looper.getMainLooper())
    private var pending = false

    /** Отложенное обновление: несколько событий подряд дают одну перерисовку */
    fun request(ctx: Context) {
        if (pending) return
        pending = true
        main.postDelayed({
            pending = false
            update(ctx)
        }, 300)
    }

    fun update(ctx: Context) {
        val app = ctx.applicationContext
        val manager = AppWidgetManager.getInstance(app)
        val ids = manager.getAppWidgetIds(ComponentName(app, PlayerWidget::class.java))
        if (ids.isEmpty()) return

        var title = "Amber"
        Lang.init(app)
        var artist = Lang.t("Нажми, чтобы выбрать музыку", "Tap to pick music")
        var artUri: String? = null
        var playing = false
        val cur = try {
            PlayerHub.current()
        } catch (_: Exception) {
            null
        }
        if (cur != null) {
            title = cur.title
            artist = cur.artist
            artUri = cur.artUri
            playing = PlayerHub.engine?.active?.playWhenReady == true
        } else {
            // Процесс только поднялся: берём последний трек из снимка очереди
            try {
                val q = File(app.filesDir, "queue.json")
                val pos = File(app.filesDir, "position.json")
                if (q.exists()) {
                    val items = JSONObject(q.readText()).optJSONArray("items")
                    val idx = if (pos.exists()) JSONObject(pos.readText()).optInt("index", 0) else 0
                    items?.optJSONObject(idx.coerceIn(0, maxOf(0, items.length() - 1)))?.let {
                        title = it.optString("title", title)
                        artist = it.optString("artist", artist)
                        artUri = it.optString("artUri").ifEmpty { null }
                    }
                }
            } catch (_: Exception) {
            }
        }

        val bmp = artUri?.let { uri ->
            try {
                val path = Uri.parse(uri.replace("_l.webp", "_m.webp")).path
                path?.let { BitmapFactory.decodeFile(it) }
            } catch (_: Exception) {
                null
            }
        }
        val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)
        val open = PendingIntent.getActivity(app, 10, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val prev = widgetAction(app, "prev", 11)
        val play = if (playing) widgetAction(app, "pause", 12) else mediaButton(app, KeyEvent.KEYCODE_MEDIA_PLAY, 12)
        val next = widgetAction(app, "next", 13)

        fun build(layout: Int): RemoteViews = RemoteViews(app.packageName, layout).apply {
            setTextViewText(R.id.widget_title, title)
            setTextViewText(R.id.widget_artist, artist)
            if (bmp != null) setImageViewBitmap(R.id.widget_cover, bmp) else setImageViewResource(R.id.widget_cover, R.drawable.ic_launcher_fg)
            setImageViewResource(R.id.widget_play, if (playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play)
            setContentDescription(R.id.widget_cover, Lang.t("Обложка", "Cover"))
            setContentDescription(R.id.widget_prev, Lang.t("Предыдущий", "Previous"))
            setContentDescription(R.id.widget_play, Lang.t("Играть или пауза", "Play or pause"))
            setContentDescription(R.id.widget_next, Lang.t("Следующий", "Next"))
            setOnClickPendingIntent(R.id.widget_root, open)
            setOnClickPendingIntent(R.id.widget_prev, prev)
            setOnClickPendingIntent(R.id.widget_play, play)
            setOnClickPendingIntent(R.id.widget_next, next)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: система сама берёт подходящую раскладку под размер ячейки
            val views = RemoteViews(
                mapOf(
                    SizeF(180f, 50f) to build(R.layout.widget_player),
                    SizeF(180f, 100f) to build(R.layout.widget_player_tall),
                ),
            )
            manager.updateAppWidget(ids, views)
        } else {
            for (id in ids) {
                val h = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
                manager.updateAppWidget(id, build(if (h >= 100) R.layout.widget_player_tall else R.layout.widget_player))
            }
        }
    }

    private fun widgetAction(ctx: Context, action: String, request: Int): PendingIntent {
        val intent = Intent(ctx, WidgetActionReceiver::class.java).putExtra("action", action)
        return PendingIntent.getBroadcast(ctx, 100 + request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun mediaButton(ctx: Context, keyCode: Int, request: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
            .setComponent(ComponentName(ctx, MediaButtonReceiver::class.java))
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        return PendingIntent.getBroadcast(ctx, request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
