package app.yantar.player.playback

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * Эффекты звука: эхо, зал, бас, ширина, 8D, «за стеной», радио, караоке.
 *
 * Процессор стоит в цепочке каждой деки после Fader (хвост эха и зала не обрывается кривой перехода),
 * до Sonic: скорость и тон применяются уже к звуку с эффектами, как в «slowed + reverb».
 * Настройки общие для обеих дек. Сила каждого эффекта 0..1, 0 — выключен. Сила идёт к цели плавно
 * (≈40 мс), поэтому включение и ползунок не щёлкают.
 */
class SoundEffects(private val settings: Settings) : BaseAudioProcessor() {

    class Settings {
        /** Цель силы по номеру эффекта (IDS) */
        @Volatile var target = FloatArray(IDS.size)

        fun set(json: JSONObject) {
            target = FloatArray(IDS.size) { i -> json.optDouble(IDS[i], 0.0).toFloat().coerceIn(0f, 1f) }
        }

        fun json(): JSONObject {
            val o = JSONObject()
            val t = target
            IDS.forEachIndexed { i, id -> if (t[i] > 0f) o.put(id, Math.round(t[i] * 100) / 100.0) }
            return o
        }
    }

    companion object {
        val IDS = listOf("echo", "reverb", "bass", "wide", "orbit", "wall", "radio", "karaoke")
        private const val ECHO = 0
        private const val REVERB = 1
        private const val BASS = 2
        private const val WIDE = 3
        private const val ORBIT = 4
        private const val WALL = 5
        private const val RADIO = 6
        private const val KARAOKE = 7
    }

    /** Текущая (сглаженная) сила эффектов */
    private val cur = FloatArray(IDS.size)
    private var sr = 0
    private var smooth = 0f

    // эхо: пинг-понг между каналами
    private var echoL = FloatArray(0)
    private var echoR = FloatArray(0)
    private var echoPos = 0
    private var echoLen = 0
    private var echoLive = false

    // зал: Freeverb (8 гребенчатых и 4 всепропускающих фильтра на канал)
    private val combL = arrayOfNulls<Comb>(8)
    private val combR = arrayOfNulls<Comb>(8)
    private val apL = arrayOfNulls<Allpass>(4)
    private val apR = arrayOfNulls<Allpass>(4)
    private var reverbLive = false

    // фильтры
    private val bassL = Biquad()
    private val bassR = Biquad()
    private val wallL = Biquad()
    private val wallR = Biquad()
    private val radioHp = Biquad()
    private val radioLp = Biquad()
    private val karaokeLow = Biquad()
    private var bassFor = -1f
    private var wallFor = -1f

    // 8D: фаза медленного вращения
    private var orbitPhase = 0.0

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val pcm = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
        return if (pcm && inputAudioFormat.channelCount in 1..2) inputAudioFormat else AudioProcessor.AudioFormat.NOT_SET
    }

    override fun onFlush() {
        // Перемотка или новый трек: хвосты старого места не должны звучать поверх нового
        prepare(inputAudioFormat.sampleRate)
        clearTails()
    }

    override fun onReset() {
        sr = 0
        echoL = FloatArray(0)
        echoR = FloatArray(0)
        for (i in 0 until 8) {
            combL[i] = null
            combR[i] = null
        }
        for (i in 0 until 4) {
            apL[i] = null
            apR[i] = null
        }
        cur.fill(0f)
    }

    private fun prepare(rate: Int) {
        if (rate <= 0 || rate == sr) return
        sr = rate
        smooth = (1 - exp(-1.0 / (0.04 * rate))).toFloat()
        echoLen = (0.32 * rate).toInt()
        echoL = FloatArray(echoLen)
        echoR = FloatArray(echoLen)
        echoPos = 0
        val k = rate / 44100.0
        val combs = intArrayOf(1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
        val aps = intArrayOf(556, 441, 341, 225)
        for (i in 0 until 8) {
            combL[i] = Comb((combs[i] * k).toInt())
            combR[i] = Comb(((combs[i] + 23) * k).toInt())
        }
        for (i in 0 until 4) {
            apL[i] = Allpass((aps[i] * k).toInt())
            apR[i] = Allpass(((aps[i] + 23) * k).toInt())
        }
        karaokeLow.lowpass(rate, 160.0, 0.707)
        radioHp.highpass(rate, 420.0, 0.8)
        radioLp.lowpass(rate, 3200.0, 0.9)
        bassFor = -1f
        wallFor = -1f
    }

    private fun clearTails() {
        echoL.fill(0f)
        echoR.fill(0f)
        echoLive = false
        combL.forEach { it?.clear() }
        combR.forEach { it?.clear() }
        apL.forEach { it?.clear() }
        apR.forEach { it?.clear() }
        reverbLive = false
        for (b in listOf(bassL, bassR, wallL, wallR, radioHp, radioLp, karaokeLow)) b.clear()
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val fmt = inputAudioFormat
        prepare(fmt.sampleRate)
        val target = settings.target
        val out = replaceOutputBuffer(size)
        var idle = true
        for (i in cur.indices) if (cur[i] > 0.0005f || target[i] > 0f) idle = false
        if (idle) {
            // Всё выключено: звук проходит как есть, хвосты сброшены, чтобы при включении не всплыло старое
            if (cur.any { it != 0f }) {
                cur.fill(0f)
                clearTails()
            }
            out.put(inputBuffer)
            out.flip()
            return
        }
        // Выключенное эхо или зал не должны при следующем включении проиграть старый хвост
        if (echoLive && cur[ECHO] <= 0.0005f && target[ECHO] == 0f) {
            echoL.fill(0f)
            echoR.fill(0f)
            echoLive = false
        }
        if (reverbLive && cur[REVERB] <= 0.0005f && target[REVERB] == 0f) {
            combL.forEach { it?.clear() }
            combR.forEach { it?.clear() }
            apL.forEach { it?.clear() }
            apR.forEach { it?.clear() }
            reverbLive = false
        }
        inputBuffer.order(ByteOrder.nativeOrder())
        val ch = fmt.channelCount
        val frames = size / fmt.bytesPerFrame
        val pcm16 = fmt.encoding == C.ENCODING_PCM_16BIT
        updateFilters()
        for (f in 0 until frames) {
            for (i in cur.indices) cur[i] += (target[i] - cur[i]) * smooth
            var l: Float
            var r: Float
            if (pcm16) {
                l = inputBuffer.getShort() / 32768f
                r = if (ch == 2) inputBuffer.getShort() / 32768f else l
            } else {
                l = inputBuffer.getFloat()
                r = if (ch == 2) inputBuffer.getFloat() else l
            }

            // караоке: голос обычно в центре — остаётся разница каналов, бас из середины возвращаем
            val kar = cur[KARAOKE]
            if (kar > 0.0005f && ch == 2) {
                val side = (l - r) * 0.5f
                val low = karaokeLow.run((l + r) * 0.5f)
                l += (side + low - l) * kar
                r += (-side + low - r) * kar
            }
            // бас: полка на низах
            if (cur[BASS] > 0.0005f) {
                l = bassL.run(l)
                r = bassR.run(r)
            }
            // за стеной: срез верхов опускается до 500 Гц
            if (cur[WALL] > 0.0005f) {
                l = wallL.run(l)
                r = wallR.run(r)
            }
            // радио: узкая полоса, моно и лёгкий перегруз
            val rad = cur[RADIO]
            if (rad > 0.0005f) {
                val m = radioLp.run(radioHp.run((l + r) * 0.5f))
                val w = (tanh(m * 2.2f) / 0.976f) * 1.25f
                l += (w - l) * rad
                r += (w - r) * rad
            }
            // ширина: боковой сигнал громче среднего
            val wide = cur[WIDE]
            if (wide > 0.0005f && ch == 2) {
                val mid = (l + r) * 0.5f
                val side = (l - r) * 0.5f * (1f + 1.3f * wide)
                val norm = 1f / (1f + 0.35f * wide)
                l = (mid + side) * norm
                r = (mid - side) * norm
            }
            // 8D: звук медленно ходит вокруг головы (круг за 10 секунд)
            val orb = cur[ORBIT]
            if (orb > 0.0005f) {
                orbitPhase += 2 * PI * 0.1 / sr
                if (orbitPhase > 2 * PI) orbitPhase -= 2 * PI
                val theta = (sin(orbitPhase) + 1) * PI / 4
                val m = (l + r) * 0.5f
                val pl = (m * cos(theta) * 1.4142135).toFloat()
                val pr = (m * sin(theta) * 1.4142135).toFloat()
                l += (pl - l) * orb
                r += (pr - r) * orb
            }
            // эхо: повтор через 320 мс, отражения прыгают между каналами
            val echo = cur[ECHO]
            if (echo > 0.0005f) {
                echoLive = true
                val yl = echoL[echoPos]
                val yr = echoR[echoPos]
                val fb = 0.3f + 0.3f * echo
                echoL[echoPos] = (l + r) * 0.5f + yr * fb
                echoR[echoPos] = yl * fb
                echoPos = if (echoPos + 1 >= echoLen) 0 else echoPos + 1
                val wet = 0.6f * echo
                l += yl * wet
                r += yr * wet
            }
            // зал
            val rev = cur[REVERB]
            if (rev > 0.0005f) {
                reverbLive = true
                val room = 0.78f + 0.18f * rev
                val input = (l + r) * 0.015f
                var ol = 0f
                var or = 0f
                for (i in 0 until 8) {
                    ol += combL[i]!!.run(input, room, 0.35f)
                    or += combR[i]!!.run(input, room, 0.35f)
                }
                for (i in 0 until 4) {
                    ol = apL[i]!!.run(ol)
                    or = apR[i]!!.run(or)
                }
                val wet = 0.9f * rev
                val dry = 1f - 0.3f * rev
                l = l * dry + ol * wet
                r = r * dry + or * wet
            }

            l = soft(l)
            r = soft(r)
            if (ch == 1) {
                val m = (l + r) * 0.5f
                if (pcm16) out.putShort((m * 32767f).toInt().toShort()) else out.putFloat(m)
            } else if (pcm16) {
                out.putShort((l * 32767f).toInt().toShort())
                out.putShort((r * 32767f).toInt().toShort())
            } else {
                out.putFloat(l)
                out.putFloat(r)
            }
        }
        while (inputBuffer.hasRemaining()) out.put(inputBuffer.get())
        out.flip()
    }

    /** Коэффициенты фильтров, зависящих от силы, пересчитываются раз в буфер (10–20 мс) */
    private fun updateFilters() {
        val b = cur[BASS]
        if (abs(b - bassFor) > 0.004f) {
            bassFor = b
            bassL.lowShelf(sr, 95.0, 11.0 * b)
            bassR.copyFrom(bassL)
        }
        val w = cur[WALL]
        if (abs(w - wallFor) > 0.004f) {
            wallFor = w
            val hz = 12000.0 * (500.0 / 12000.0).pow(w.toDouble())
            wallL.lowpass(sr, hz, 0.75)
            wallR.copyFrom(wallL)
        }
    }

    /** Мягкий потолок: эффекты добавляют энергии, пики скругляются, а не режутся */
    private fun soft(x: Float): Float {
        val a = abs(x)
        if (a <= 0.85f) return x
        val y = 0.85f + 0.15f * tanh((a - 0.85f) / 0.15f)
        return if (x < 0) -y else y
    }

    /** Биквад (RBJ), прямая форма I: спокойно переносит смену коэффициентов на ходу */
    private class Biquad {
        private var b0 = 1.0
        private var b1 = 0.0
        private var b2 = 0.0
        private var a1 = 0.0
        private var a2 = 0.0
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        fun run(x: Float): Float {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = x.toDouble()
            y2 = y1
            y1 = y
            return y.toFloat()
        }

        fun clear() {
            x1 = 0.0
            x2 = 0.0
            y1 = 0.0
            y2 = 0.0
        }

        fun copyFrom(o: Biquad) {
            b0 = o.b0
            b1 = o.b1
            b2 = o.b2
            a1 = o.a1
            a2 = o.a2
        }

        private fun set(nb0: Double, nb1: Double, nb2: Double, na0: Double, na1: Double, na2: Double) {
            b0 = nb0 / na0
            b1 = nb1 / na0
            b2 = nb2 / na0
            a1 = na1 / na0
            a2 = na2 / na0
        }

        fun lowpass(sr: Int, hz: Double, q: Double) {
            val w = 2 * PI * hz / sr
            val al = sin(w) / (2 * q)
            val c = cos(w)
            set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al)
        }

        fun highpass(sr: Int, hz: Double, q: Double) {
            val w = 2 * PI * hz / sr
            val al = sin(w) / (2 * q)
            val c = cos(w)
            set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)
        }

        fun lowShelf(sr: Int, hz: Double, db: Double) {
            val a = 10.0.pow(db / 40)
            val w = 2 * PI * hz / sr
            val c = cos(w)
            val al = sin(w) / 2 * sqrt(2.0)
            val sa = 2 * sqrt(a) * al
            set(
                a * ((a + 1) - (a - 1) * c + sa),
                2 * a * ((a - 1) - (a + 1) * c),
                a * ((a + 1) - (a - 1) * c - sa),
                (a + 1) + (a - 1) * c + sa,
                -2 * ((a - 1) + (a + 1) * c),
                (a + 1) + (a - 1) * c - sa,
            )
        }
    }

    private class Comb(size: Int) {
        private val buf = FloatArray(max(1, size))
        private var pos = 0
        private var store = 0f

        fun run(x: Float, feedback: Float, damp: Float): Float {
            val y = buf[pos]
            store = y * (1 - damp) + store * damp
            buf[pos] = x + store * feedback
            pos = if (pos + 1 >= buf.size) 0 else pos + 1
            return y
        }

        fun clear() {
            buf.fill(0f)
            store = 0f
        }
    }

    private class Allpass(size: Int) {
        private val buf = FloatArray(max(1, size))
        private var pos = 0

        fun run(x: Float): Float {
            val b = buf[pos]
            buf[pos] = x + b * 0.5f
            pos = if (pos + 1 >= buf.size) 0 else pos + 1
            return b - x
        }

        fun clear() = buf.fill(0f)
    }
}
