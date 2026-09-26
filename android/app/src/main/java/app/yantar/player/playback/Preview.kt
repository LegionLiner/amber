package app.yantar.player.playback

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * Предпрослушивание вне очереди: «лучший момент» трека в дуэлях и стык двух треков в редакторе миксов.
 * Свои плееры, основная очередь не трогается (её ставят на паузу снаружи).
 */
class Preview(private val ctx: Context, private val onEnded: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var a: ExoPlayer? = null
    private var b: ExoPlayer? = null

    private fun make(): ExoPlayer {
        val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
        return ExoPlayer.Builder(ctx).setAudioAttributes(attrs, false).build()
    }

    private var ticker: Runnable? = null

    fun stop() {
        ticker?.let { main.removeCallbacks(it) }
        ticker = null
        a?.release()
        b?.release()
        a = null
        b = null
    }

    /** Отрывок с плавным входом и выходом */
    fun snippet(uri: String, fromMs: Long, durationMs: Long, gainDb: Double) {
        stop()
        val p = make().also { a = it }
        val gain = 10.0.pow(gainDb / 20).coerceIn(0.0, 1.0).toFloat()
        p.setMediaItem(MediaItem.fromUri(Uri.parse(uri)), fromMs)
        p.volume = 0f
        p.prepare()
        p.play()
        val start = SystemClock.elapsedRealtime()
        val fade = 600L
        val t = object : Runnable {
            override fun run() {
                val el = SystemClock.elapsedRealtime() - start
                val f = when {
                    el < fade -> el.toFloat() / fade
                    el > durationMs - fade -> ((durationMs - el).toFloat() / fade).coerceAtLeast(0f)
                    else -> 1f
                }
                p.volume = gain * f
                if (el >= durationMs) {
                    stop()
                    onEnded()
                    return
                }
                main.postDelayed(this, 30)
            }
        }
        ticker = t
        main.post(t)
    }

    /**
     * Стык: A играет с fromMs, в момент atMs (позиция в A) стартует B с cueMs и переход длиной durationMs.
     * Всего звучит leadMs до стыка и tailMs после.
     */
    fun junction(
        aUri: String,
        atMs: Long,
        bUri: String,
        cueMs: Long,
        type: String,
        durationMs: Long,
        curve: String,
        duckDb: Double,
        leadMs: Long,
        tailMs: Long,
    ) {
        stop()
        val pa = make().also { a = it }
        val pb = make().also { b = it }
        pa.setMediaItem(MediaItem.fromUri(Uri.parse(aUri)), (atMs - leadMs).coerceAtLeast(0))
        pb.setMediaItem(MediaItem.fromUri(Uri.parse(bUri)), cueMs)
        pa.prepare()
        pb.prepare()
        pb.volume = 0f
        pa.volume = 1f
        pa.play()
        val start = SystemClock.elapsedRealtime()
        val lead = minOf(leadMs, atMs)
        val duck = 10.0.pow(duckDb / 20).toFloat()
        var bStarted = false
        val t = object : Runnable {
            override fun run() {
                val el = SystemClock.elapsedRealtime() - start
                if (el >= lead && !bStarted) {
                    bStarted = true
                    if (type == "gapless" || type == "cut") {
                        pa.pause()
                        pb.volume = 1f
                    }
                    if (type != "fadeOutIn") pb.play()
                }
                if (bStarted && type == "fadeOutIn" && !pb.playWhenReady && pa.volume <= 0.01f) {
                    pb.volume = 1f
                    pb.play()
                }
                if (bStarted && type != "gapless" && type != "cut") {
                    val x = ((el - lead).toFloat() / durationMs.coerceAtLeast(1)).coerceIn(0f, 1f)
                    val (inF, outF) = when (type) {
                        "overlay" -> (x / 0.08f).coerceAtMost(1f) to when {
                            x < 0.15f -> 1f - (1f - duck) * (x / 0.15f)
                            x < 0.75f -> duck
                            else -> duck * (1f - (x - 0.75f) / 0.25f)
                        }
                        "fadeOutIn" -> (if (x >= 1f) 1f else 0f) to (1f - x)
                        else -> when (curve) {
                            "linear" -> x to (1 - x)
                            "sCurve" -> (0.5 - 0.5 * cos(PI * x)).toFloat() to (0.5 + 0.5 * cos(PI * x)).toFloat()
                            else -> sin(x * PI / 2).toFloat() to cos(x * PI / 2).toFloat()
                        }
                    }
                    pb.volume = inF
                    pa.volume = outF
                    if (x >= 1f) pa.pause()
                }
                if (el >= lead + tailMs) {
                    stop()
                    onEnded()
                    return
                }
                main.postDelayed(this, 30)
            }
        }
        ticker = t
        main.post(t)
    }
}
