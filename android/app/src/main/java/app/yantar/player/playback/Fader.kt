package app.yantar.player.playback

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Кривая перехода прямо в звуке деки: процессор стоит в цепочке ExoPlayer и работает
 * на его потоке воспроизведения, громкость меняется плавно по каждому сэмплу.
 *
 * Раньше кривую вёл таймер главного потока через ExoPlayer.volume. Когда интерфейс рисовал
 * тяжёлый кадр (смена трека в полном плеере), главный поток замирал на полсекунды,
 * громкость стояла, а потом прыгала — переход шёл ступеньками.
 *
 * Время перехода считает сам звук входящего трека (B): его процессор отсчитывает, сколько звука
 * через него прошло. Уходящий трек (A) затихает по этим же часам — поэтому A начинает уходить
 * только когда B реально пошёл, и никакой провал из-за медленного старта деки невозможен.
 */
class Fader : BaseAudioProcessor() {

    /** Часы перехода, общие для входящей и уходящей деки */
    class Clock {
        /** Сколько звука входящей деки обработано с начала перехода, вместе с предзагрузкой (мкс) */
        @Volatile var processedUs = 0L

        /** То же, но только после старта воспроизведения: по этим часам уходит A */
        @Volatile var playedUs = 0L

        @Volatile var playing = false
    }

    enum class Role { IN, OUT, FADE_OUT }

    class Plan(
        val role: Role,
        val type: String,
        val curve: String,
        val durUs: Long,
        val duck: Float,
        val clock: Clock,
    )

    @Volatile var plan: Plan? = null
        private set

    /** Затухание (FADE_OUT) дошло до тишины */
    @Volatile var silent = false
        private set

    /** Громкость на конце прошлого буфера: от неё начинается следующий, без скачков */
    private var lastGain = 1f

    /** Входящая дека: кривая идёт по её собственному звуку с первого сэмпла (с точки входа) */
    fun armIn(type: String, curve: String, durMs: Long, duck: Float): Clock {
        val c = Clock()
        plan = Plan(Role.IN, type, curve, durMs * 1000, duck, c)
        return c
    }

    /** Уходящая дека: затихает по часам входящей */
    fun armOut(clock: Clock, type: String, curve: String, durMs: Long, duck: Float) {
        plan = Plan(Role.OUT, type, curve, durMs * 1000, duck, clock)
    }

    /** Затухание одной деки («затухание» между треками): по своему звуку */
    fun armFadeOut(durMs: Long) {
        silent = false
        plan = Plan(Role.FADE_OUT, "fadeOutIn", "linear", durMs * 1000, 0f, Clock())
    }

    /** Без кривой: полная громкость (с плавным возвратом, если была кривая) */
    fun clear() {
        plan = null
        silent = false
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        // PCM 16 бит — обычный выход декодеров; float — при высоком разрешении. Остальное пропускаем как есть
        return if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            inputAudioFormat
        } else {
            AudioProcessor.AudioFormat.NOT_SET
        }
    }

    override fun onFlush() {
        // Перемотка: предзагрузка входящей деки начнётся заново с точки входа — и часы с нуля
        val p = plan ?: return
        if (p.role == Role.IN || p.role == Role.FADE_OUT) {
            p.clock.processedUs = 0
            p.clock.playedUs = 0
            lastGain = gainAt(p, 0)
        }
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val fmt = inputAudioFormat
        val frames = size / fmt.bytesPerFrame
        val bufUs = frames * 1_000_000L / fmt.sampleRate
        val p = plan
        val target = if (p == null) {
            1f
        } else {
            val c = p.clock
            when (p.role) {
                Role.OUT -> gainAt(p, c.playedUs)
                else -> {
                    val end = c.processedUs + bufUs
                    c.processedUs = end
                    if (c.playing) c.playedUs += bufUs
                    gainAt(p, end).also { if (p.role == Role.FADE_OUT && it <= 0.0001f) silent = true }
                }
            }
        }
        val out = replaceOutputBuffer(size)
        val from = lastGain
        lastGain = target
        if (from == 1f && target == 1f) {
            out.put(inputBuffer)
            out.flip()
            return
        }
        inputBuffer.order(ByteOrder.nativeOrder())
        val ch = fmt.channelCount
        val step = (target - from) / frames
        var g = from
        if (fmt.encoding == C.ENCODING_PCM_16BIT) {
            for (i in 0 until frames) {
                for (k in 0 until ch) {
                    val v = (inputBuffer.getShort() * g).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                    out.putShort(v.toShort())
                }
                g += step
            }
        } else {
            for (i in 0 until frames) {
                for (k in 0 until ch) out.putFloat(inputBuffer.getFloat() * g)
                g += step
            }
        }
        // Остаток неполного кадра (не бывает, но буфер должен быть прочитан целиком)
        while (inputBuffer.hasRemaining()) out.put(inputBuffer.get())
        out.flip()
    }

    private fun gainAt(p: Plan, us: Long): Float {
        val x = (us.toDouble() / p.durUs.coerceAtLeast(1)).coerceIn(0.0, 1.0).toFloat()
        return when (p.role) {
            Role.IN -> if (p.type == "overlay") min(1f, x / 0.08f) else curveIn(p.curve, x)
            Role.OUT -> if (p.type == "overlay") overlayOut(x, p.duck) else curveOut(p.curve, x)
            Role.FADE_OUT -> cos(x * PI / 2).toFloat()
        }
    }

    private fun curveIn(curve: String, t: Float): Float = when (curve) {
        "linear" -> t
        "sCurve" -> (0.5 - 0.5 * cos(PI * t)).toFloat()
        else -> sin(t * PI / 2).toFloat()
    }

    private fun curveOut(curve: String, t: Float): Float = when (curve) {
        "linear" -> 1 - t
        "sCurve" -> (0.5 + 0.5 * cos(PI * t)).toFloat()
        else -> cos(t * PI / 2).toFloat()
    }

    /** Наложение: B входит почти сразу, A отходит на второй план и уходит в конце */
    private fun overlayOut(x: Float, duck: Float): Float = when {
        x < 0.15f -> 1f - (1f - duck) * (x / 0.15f)
        x < 0.75f -> duck
        else -> duck * (1f - (x - 0.75f) / 0.25f)
    }
}
