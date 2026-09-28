package app.yantar.player.playback

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** Эффекты на чистом звуке: прозрачность выключенных, эхо на месте, никаких NaN и перегруза */
class SoundEffectsTest {
    private val rate = 44100

    private fun processor(encoding: Int): Pair<SoundEffects, SoundEffects.Settings> {
        val s = SoundEffects.Settings()
        val p = SoundEffects(s)
        p.configure(AudioProcessor.AudioFormat(rate, 2, encoding))
        p.flush()
        return p to s
    }

    private fun run(p: SoundEffects, samples: FloatArray, encoding: Int): FloatArray {
        val out = ArrayList<Float>()
        val chunk = 2048
        var i = 0
        while (i < samples.size) {
            val n = minOf(chunk, samples.size - i)
            val bytes = if (encoding == C.ENCODING_PCM_16BIT) 2 else 4
            val buf = ByteBuffer.allocateDirect(n * bytes).order(ByteOrder.nativeOrder())
            for (k in 0 until n) {
                if (encoding == C.ENCODING_PCM_16BIT) buf.putShort((samples[i + k] * 32767f).toInt().toShort())
                else buf.putFloat(samples[i + k])
            }
            buf.flip()
            p.queueInput(buf)
            val o = p.output.order(ByteOrder.nativeOrder())
            while (o.hasRemaining()) out.add(if (encoding == C.ENCODING_PCM_16BIT) o.getShort() / 32767f else o.getFloat())
            i += n
        }
        return out.toFloatArray()
    }

    private fun sine(seconds: Double, amp: Float): FloatArray {
        val frames = (seconds * rate).toInt()
        return FloatArray(frames * 2) { i -> amp * sin(2 * PI * 220 * (i / 2) / rate).toFloat() * if (i % 2 == 0) 1f else 0.8f }
    }

    @Test
    fun allOffIsTransparent() {
        val (p, _) = processor(C.ENCODING_PCM_16BIT)
        val input = sine(0.5, 0.5f)
        val out = run(p, input, C.ENCODING_PCM_16BIT)
        assertEquals(input.size, out.size)
        val q = { a: FloatArray -> FloatArray(a.size) { (a[it] * 32767f).toInt() / 32767f } }
        assertArrayEquals(q(input), out, 1e-6f)
    }

    @Test
    fun echoRepeatsAfterAThirdOfASecond() {
        val (p, s) = processor(C.ENCODING_PCM_FLOAT)
        s.target = FloatArray(SoundEffects.IDS.size).also { it[SoundEffects.IDS.indexOf("echo")] = 1f }
        run(p, FloatArray(rate / 5 * 2), C.ENCODING_PCM_FLOAT) // сила успевает дойти до цели
        val impulse = FloatArray(rate * 2).also {
            it[0] = 0.5f
            it[1] = 0.5f
        }
        val out = run(p, impulse, C.ENCODING_PCM_FLOAT)
        val delay = (0.32 * rate).toInt()
        // первое отражение — в левом канале, второе — в правом (пинг-понг)
        assertTrue("эхо слева: ${out[delay * 2]}", out[delay * 2] > 0.2f)
        assertTrue("эхо справа: ${out[delay * 4 + 1]}", out[delay * 4 + 1] > 0.05f)
        assertTrue("до эха тихо", abs(out[(delay / 2) * 2]) < 1e-4f)
    }

    @Test
    fun everythingOnStaysFiniteAndUnderCeiling() {
        val (p, s) = processor(C.ENCODING_PCM_FLOAT)
        s.target = FloatArray(SoundEffects.IDS.size) { 1f }
        val out = run(p, sine(2.0, 0.95f), C.ENCODING_PCM_FLOAT)
        assertTrue(out.all { it.isFinite() })
        assertTrue("пик ${out.maxOf { abs(it) }}", out.all { abs(it) <= 1f })
        assertTrue("звук есть", out.drop(rate).maxOf { abs(it) } > 0.1f)
    }

    @Test
    fun switchedOffEchoDoesNotReplayOldTail() {
        val (p, s) = processor(C.ENCODING_PCM_FLOAT)
        val echo = FloatArray(SoundEffects.IDS.size).also { it[SoundEffects.IDS.indexOf("echo")] = 1f }
        s.target = echo
        run(p, sine(0.5, 0.8f), C.ENCODING_PCM_FLOAT)
        s.target = FloatArray(SoundEffects.IDS.size)
        run(p, FloatArray(rate / 2 * 2), C.ENCODING_PCM_FLOAT)
        s.target = echo
        val out = run(p, FloatArray(rate / 2 * 2), C.ENCODING_PCM_FLOAT)
        assertTrue("старое эхо не всплыло: ${out.maxOf { abs(it) }}", out.all { abs(it) < 1e-4f })
    }
}
