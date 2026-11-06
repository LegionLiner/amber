package app.yantar.player.online

import android.content.Context
import android.net.Uri
import app.yantar.player.core.Lang

/**
 * Сборка для Google Play: загрузки с YouTube нет (правила магазина). Та же форма, что у src/site/…/YouTube.kt,
 * но без библиотеки NewPipe — её в этой сборке нет вовсе. Интерфейс кнопку и не показывает (VITE_STORE=play).
 */
object YouTube {
    class Info(val title: String, val artist: String, val uploader: String, val durationMs: Long, val thumbnail: String?)

    class Saved(val uri: Uri, val path: String, val name: String)

    private fun unavailable(): Nothing =
        throw UnsupportedOperationException(Lang.t("В этой версии загрузки с YouTube нет", "YouTube downloads are not available in this version"))

    fun info(url: String): Info = unavailable()

    fun download(ctx: Context, info: Info, title: String, artist: String, progress: (String, Long, Long) -> Unit): Saved =
        unavailable()

    fun errorText(e: Throwable): String = e.message ?: e.toString()
}
