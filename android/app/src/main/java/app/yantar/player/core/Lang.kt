package app.yantar.player.core

import android.content.Context
import java.util.Locale

/**
 * Язык нативной части: уведомление, виджет, ошибки движка. Его сообщает интерфейс (configure),
 * он запоминается — виджет и сервис знают язык, даже когда окно приложения не открыто.
 * До первого сообщения — по языку системы.
 */
object Lang {
    private const val PREFS = "amber_lang"

    @Volatile
    private var en: Boolean? = null

    fun init(ctx: Context) {
        if (en != null) return
        val saved = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("lang", null)
        en = saved?.let { it == "en" } ?: !Locale.getDefault().language.equals("ru", ignoreCase = true)
    }

    /** Возвращает true, если язык сменился */
    fun set(ctx: Context, lang: String): Boolean {
        val v = lang == "en"
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("lang", lang).apply()
        val changed = en != v
        en = v
        return changed
    }

    val isEn: Boolean
        get() = en ?: !Locale.getDefault().language.equals("ru", ignoreCase = true)

    /** Строка на языке интерфейса */
    fun t(ru: String, en: String): String = if (isEn) en else ru

    /** Для HTTP-запросов к компьютеру: ответы об ошибках приходят на этом языке */
    val tag: String
        get() = if (isEn) "en" else "ru"
}
