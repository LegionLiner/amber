package app.yantar.player.tracking

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import app.yantar.player.db.Database
import java.time.ZonedDateTime

/**
 * Учёт прослушиваний. Работает в движке, поэтому пишет события даже при выключенном экране.
 *
 * Жизнь события: трек начал звучать → INSERT; каждые 10 секунд → UPDATE listened_ms;
 * трек закончился (дослушан, пропущен, заменён, остановлен) → финальный UPDATE с причиной и «засчитано».
 * Если процесс убьют, потеряется не больше 10 секунд, а при следующем запуске
 * незакрытое событие закроется с причиной «stopped».
 *
 * Правило «засчитано» то же, что в src/domain/counting.ts.
 */
class PlayTracker(private val ctx: Context) {

    data class Rule(val minTrackMs: Long, val minFraction: Double, val minListenMs: Long)

    class Logged(val id: Long, val key: String, val startedAt: Long, val listenedMs: Long, val endReason: String, val counted: Boolean)

    @Volatile
    var rule = Rule(30_000, 0.5, 240_000)

    /** Вызывается в главном потоке после записи события */
    var onLogged: ((Logged) -> Unit)? = null

    private class Live(
        val key: String,
        val startedAt: Long,
        val durationMs: Long,
    ) {
        @Volatile
        var rowId: Long = -1
        var listenedMs: Long = 0
        var tickAt: Long = 0
        var playing = false
    }

    private val main = Handler(Looper.getMainLooper())
    private var live: Live? = null
    private var lastEndAt = 0L
    private var sessionId = 0L
    private var positionProvider: () -> Long = { 0L }
    private var outputProvider: () -> String = { "unknown" }

    private val checkpoint = object : Runnable {
        override fun run() {
            save()
            main.postDelayed(this, 10_000)
        }
    }

    fun init(position: () -> Long, output: () -> String) {
        positionProvider = position
        outputProvider = output
        Database.io.execute {
            try {
                if (!Database.hasTable("play_events")) return@execute
                // Незакрытые события прошлого запуска
                Database.execute(
                    """UPDATE play_events SET end_reason = 'stopped',
                       ended_at = COALESCE(ended_at, started_at + listened_ms),
                       counted = ${countedSql()} WHERE end_reason IS NULL""",
                    emptyList(),
                )
                val r = Database.query(
                    "SELECT MAX(session_id), MAX(COALESCE(ended_at, started_at)) FROM play_events",
                    emptyList(),
                ).rows.firstOrNull()
                sessionId = (r?.get(0) as? Long) ?: 0L
                lastEndAt = (r?.get(1) as? Long) ?: 0L
            } catch (_: Exception) {
            }
        }
    }

    private fun countedSql(): String {
        val r = rule
        return """CASE WHEN duration_ms > 0 AND duration_ms < ${r.minTrackMs} THEN 0
            WHEN listened_ms >= (CASE WHEN duration_ms > 0 THEN MIN(duration_ms * ${r.minFraction}, ${r.minListenMs}) ELSE ${r.minListenMs} END) THEN 1
            ELSE 0 END"""
    }

    fun isCounted(durationMs: Long, listenedMs: Long): Boolean {
        val r = rule
        if (durationMs in 1 until r.minTrackMs) return false
        val need = if (durationMs > 0) minOf((durationMs * r.minFraction).toLong(), r.minListenMs) else r.minListenMs
        return listenedMs >= need
    }

    /** Звук пошёл или остановился */
    fun onPlayingChanged(playing: Boolean, key: String?, durationMs: Long, sourceType: String?, sourceId: String?) {
        val l = live
        if (playing) {
            if (l == null) {
                if (key != null) start(key, durationMs, sourceType, sourceId)
            } else if (!l.playing) {
                l.playing = true
                l.tickAt = SystemClock.elapsedRealtime()
            }
        } else if (l != null && l.playing) {
            accumulate(l)
            l.playing = false
            save()
        }
    }

    private fun accumulate(l: Live) {
        if (!l.playing) return
        val now = SystemClock.elapsedRealtime()
        l.listenedMs += (now - l.tickAt).coerceAtLeast(0)
        l.tickAt = now
    }

    private fun start(key: String, durationMs: Long, sourceType: String?, sourceId: String?) {
        val now = System.currentTimeMillis()
        if (now - lastEndAt > 30 * 60_000L || sessionId == 0L) sessionId = now
        val z = ZonedDateTime.now()
        val l = Live(key, now, durationMs).apply {
            playing = true
            tickAt = SystemClock.elapsedRealtime()
        }
        live = l
        val args = listOf<Any?>(
            key, now, z.offset.totalSeconds / 60, z.toLocalDate().toString(), z.hour, z.dayOfWeek.value,
            positionProvider(), durationMs, sourceType, sourceId, outputProvider(), sessionId,
        )
        Database.io.execute {
            try {
                l.rowId = Database.execute(
                    """INSERT INTO play_events (track_key, started_at, tz_offset, local_day, local_hour, weekday,
                       listened_ms, pos_start_ms, duration_ms, source_type, source_id, output, session_id)
                       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
                    args,
                ).lastId
            } catch (_: Exception) {
            }
        }
        main.removeCallbacks(checkpoint)
        main.postDelayed(checkpoint, 10_000)
    }

    private fun save() {
        val l = live ?: return
        accumulate(l)
        val listened = l.listenedMs
        val pos = positionProvider()
        Database.io.execute {
            if (l.rowId <= 0) return@execute
            try {
                Database.execute("UPDATE play_events SET listened_ms = ?, pos_end_ms = ? WHERE id = ?", listOf(listened, pos, l.rowId))
            } catch (_: Exception) {
            }
        }
    }

    /** Трек закончился. reason: completed | skipped | replaced | stopped | error */
    fun finish(reason: String) {
        val l = live ?: return
        live = null
        main.removeCallbacks(checkpoint)
        accumulate(l)
        val now = System.currentTimeMillis()
        lastEndAt = now
        val counted = isCounted(l.durationMs, l.listenedMs)
        val endReason = if (reason == "skipped" && counted) "completed" else reason
        val pos = positionProvider()
        val listened = l.listenedMs
        Database.io.execute {
            if (l.rowId <= 0) return@execute
            try {
                Database.execute(
                    "UPDATE play_events SET ended_at = ?, listened_ms = ?, pos_end_ms = ?, end_reason = ?, counted = ? WHERE id = ?",
                    listOf(now, listened, pos, endReason, if (counted) 1 else 0, l.rowId),
                )
                val logged = Logged(l.rowId, l.key, l.startedAt, listened, endReason, counted)
                main.post { onLogged?.invoke(logged) }
            } catch (_: Exception) {
            }
        }
    }

    fun hasLive(): Boolean = live != null

}
