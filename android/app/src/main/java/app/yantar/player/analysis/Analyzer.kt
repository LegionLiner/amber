package app.yantar.player.analysis

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.BatteryManager
import android.util.Base64
import android.util.Log
import app.yantar.player.db.Database
import app.yantar.player.playback.Loudness
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingDeque
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Анализ трека за один проход декодирования:
 *  - интегральная громкость по EBU R128 (K-фильтр, блоки 400 мс с шагом 100 мс, гейты −70 LUFS и −10 LU);
 *  - пиковый уровень;
 *  - тишина в начале и в конце (для кроссфейда и почти бесшовных стыков);
 *  - волна для плеера (1000 значений);
 *  - энергия и темп — для радио.
 *
 * Очередь: «now» — сразу (ближайшие треки очереди), «night» — только на зарядке или при открытом приложении.
 */
class Analyzer(private val ctx: Context, private val onProgress: (done: Int, total: Int, key: String) -> Unit) {

    private data class Task(val key: String, val urgent: Boolean)

    private val queue = LinkedBlockingDeque<Task>()
    private val known = HashSet<String>()
    @Volatile var uiVisible = false
    private var done = 0
    private var total = 0

    private val worker = Thread({ loop() }, "yantar-analyzer").apply {
        isDaemon = true
        priority = Thread.MIN_PRIORITY
        start()
    }

    fun enqueue(keys: List<String>, urgent: Boolean) {
        synchronized(known) {
            for (k in keys) {
                if (urgent) {
                    queue.remove(Task(k, false))
                    queue.addFirst(Task(k, true))
                    known.add(k)
                } else if (known.add(k)) {
                    queue.addLast(Task(k, false))
                }
            }
            total = done + queue.size
        }
    }

    private fun charging(): Boolean {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    }

    private fun loop() {
        while (true) {
            val task = queue.take()
            if (!task.urgent && !uiVisible && !charging()) {
                // Ночная задача ждёт зарядки или открытого приложения
                queue.addFirst(task)
                Thread.sleep(30_000)
                continue
            }
            try {
                analyzeKey(task.key)
            } catch (e: Throwable) {
                Log.w("Analyzer", "failed ${task.key}", e)
            }
            synchronized(known) {
                known.remove(task.key)
                done++
            }
            onProgress(done, total, task.key)
        }
    }

    private fun analyzeKey(key: String) {
        val row = Database.query("SELECT uri FROM tracks WHERE key = ?", listOf(key)).rows.firstOrNull() ?: return
        val r = analyze(Uri.parse(row[0] as String)) ?: return
        val wave = Base64.encodeToString(r.waveform, Base64.NO_WRAP)
        Database.execute(
            """INSERT OR REPLACE INTO analysis (key, lufs, true_peak_db, intro_silence_ms, outro_silence_ms, waveform, energy, bpm, analyzed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            listOf(key, r.lufs, r.peakDb, r.introMs, r.outroMs, wave, r.energy, r.bpm, System.currentTimeMillis()),
        )
        Loudness.update(key, r.lufs, r.introMs, r.outroMs)
    }

    class Result(
        val lufs: Double?,
        val peakDb: Double,
        val introMs: Long,
        val outroMs: Long,
        val waveform: ByteArray,
        val energy: Double,
        val bpm: Double?,
    )

    /** Биквадратный фильтр в прямой форме II (транспонированной) */
    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        var z1 = 0.0
        var z2 = 0.0
        fun process(x: Double): Double {
            val y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
    }

    /** K-фильтр из ITU-R BS.1770 для любой частоты дискретизации (коэффициенты как в libebur128) */
    private fun kFilter(fs: Double): Pair<Biquad, Biquad> {
        var f0 = 1681.974450955533
        val g = 3.999843853973347
        var q = 0.7071752369554196
        var k = tan(PI * f0 / fs)
        val vh = 10.0.pow(g / 20.0)
        val vb = vh.pow(0.4996667741545416)
        var a0 = 1.0 + k / q + k * k
        val shelf = Biquad(
            (vh + vb * k / q + k * k) / a0,
            2.0 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0,
            2.0 * (k * k - 1.0) / a0,
            (1.0 - k / q + k * k) / a0,
        )
        f0 = 38.13547087602444
        q = 0.5003270373238773
        k = tan(PI * f0 / fs)
        a0 = 1.0 + k / q + k * k
        val hp = Biquad(1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0)
        return shelf to hp
    }

    fun analyze(uri: Uri): Result? {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            ex.setDataSource(ctx, uri, null)
            val track = (0 until ex.trackCount).firstOrNull {
                ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null
            ex.selectTrack(track)
            val inFmt = ex.getTrackFormat(track)
            val mime = inFmt.getString(MediaFormat.KEY_MIME)!!
            var sampleRate = inFmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = inFmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var floatPcm = false
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(inFmt, null, null, 0)
            codec.start()

            // Состояние анализа
            var filters = Array(max(1, channels)) { kFilter(sampleRate.toDouble()) }
            var blockLen = sampleRate / 10 // 100 мс
            val subSums = ArrayList<Double>() // энергия по 100-мс кускам (сумма по каналам)
            var acc = 0.0
            var accN = 0
            var peak = 0.0
            val silence = 10.0.pow(-50.0 / 20.0)
            var firstLoud = -1L
            var lastLoud = -1L
            var frame = 0L
            val env = ArrayList<Float>() // огибающая по 10 мс для волны и темпа
            var envMax = 0.0
            var envN = 0
            var envLen = sampleRate / 100
            var sumSq = 0.0
            var sqN = 0L

            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            while (!outputDone) {
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val buf = codec.getInputBuffer(inIdx)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIdx, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val f = codec.outputFormat
                    sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        f.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                    filters = Array(max(1, channels)) { kFilter(sampleRate.toDouble()) }
                    blockLen = sampleRate / 10
                    envLen = sampleRate / 100
                } else if (outIdx >= 0) {
                    val out = codec.getOutputBuffer(outIdx)!!
                    out.position(info.offset)
                    out.limit(info.offset + info.size)
                    val bb = out.slice().order(ByteOrder.nativeOrder())
                    val samples = if (floatPcm) info.size / 4 else info.size / 2
                    val frames = samples / max(1, channels)
                    val fb = if (floatPcm) bb.asFloatBuffer() else null
                    val sb = if (!floatPcm) bb.asShortBuffer() else null
                    for (i in 0 until frames) {
                        var frameMax = 0.0
                        var frameSq = 0.0
                        for (c in 0 until channels) {
                            val idx = i * channels + c
                            val x = if (fb != null) fb.get(idx).toDouble() else sb!!.get(idx) / 32768.0
                            val ax = abs(x)
                            if (ax > frameMax) frameMax = ax
                            if (c < 2) {
                                val (shelf, hp) = filters[c]
                                val y = hp.process(shelf.process(x))
                                frameSq += y * y
                            }
                            sumSq += x * x
                            sqN++
                        }
                        acc += frameSq
                        accN++
                        if (accN >= blockLen) {
                            subSums.add(acc / accN)
                            acc = 0.0
                            accN = 0
                        }
                        if (frameMax > peak) peak = frameMax
                        if (frameMax > silence) {
                            if (firstLoud < 0) firstLoud = frame
                            lastLoud = frame
                        }
                        if (frameMax > envMax) envMax = frameMax
                        envN++
                        if (envN >= envLen) {
                            env.add(envMax.toFloat())
                            envMax = 0.0
                            envN = 0
                        }
                        frame++
                    }
                    codec.releaseOutputBuffer(outIdx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }

            // Громкость: блоки 400 мс = 4 соседних куска по 100 мс
            val blocks = ArrayList<Double>()
            for (i in 0..subSums.size - 4) blocks.add((subSums[i] + subSums[i + 1] + subSums[i + 2] + subSums[i + 3]) / 4.0)
            fun lufsOf(ms: Double) = -0.691 + 10 * log10(ms)
            val abs70 = blocks.filter { it > 0 && lufsOf(it) > -70.0 }
            val lufs = if (abs70.isEmpty()) {
                null
            } else {
                val relGate = lufsOf(abs70.average()) - 10.0
                val gated = abs70.filter { lufsOf(it) > relGate }
                if (gated.isEmpty()) null else lufsOf(gated.average())
            }

            val msPerFrame = 1000.0 / sampleRate
            val intro = if (firstLoud > 0) (firstLoud * msPerFrame).toLong() else 0L
            val outro = if (lastLoud in 0 until frame) ((frame - 1 - lastLoud) * msPerFrame).toLong() else 0L

            // Волна: 1000 значений, корень сглаживает динамику, чтобы тихие места были видны
            val wave = ByteArray(1000)
            if (env.isNotEmpty()) {
                val top = env.maxOrNull()?.takeIf { it > 0 } ?: 1f
                for (i in 0 until 1000) {
                    val from = (i.toLong() * env.size / 1000).toInt()
                    val to = max(from + 1, ((i + 1).toLong() * env.size / 1000).toInt())
                    var m = 0f
                    for (j in from until min(to, env.size)) if (env[j] > m) m = env[j]
                    wave[i] = (sqrt((m / top).toDouble()) * 255).toInt().coerceIn(0, 255).toByte()
                }
            }

            val rmsDb = if (sqN > 0) 10 * log10(sumSq / sqN + 1e-12) else -90.0
            val energy = ((rmsDb + 30.0) / 25.0).coerceIn(0.0, 1.0)
            val peakDb = if (peak > 0) 20 * log10(peak) else -90.0
            return Result(lufs, peakDb, intro, outro, wave, energy, estimateBpm(env))
        } catch (e: Throwable) {
            Log.w("Analyzer", "decode failed $uri", e)
            return null
        } finally {
            try {
                codec?.stop()
            } catch (_: Throwable) {
            }
            codec?.release()
            ex.release()
        }
    }

    /**
     * Темп по огибающей (шаг 10 мс): поток нарастаний энергии и автокорреляция в диапазоне 70–180 BPM.
     * Грубая оценка, но для радио («похожие по энергии и темпу») этого достаточно.
     */
    private fun estimateBpm(env: List<Float>): Double? {
        if (env.size < 1500) return null
        val start = env.size / 4
        val n = min(6000, env.size - start)
        val flux = DoubleArray(n)
        for (i in 1 until n) flux[i] = max(0.0, (env[start + i] - env[start + i - 1]).toDouble())
        val mean = flux.average()
        for (i in flux.indices) flux[i] -= mean
        var bestLag = 0
        var best = 0.0
        // 10 мс на отсчёт: 180 BPM = лаг 33, 70 BPM = лаг 86
        for (lag in 33..86) {
            var s = 0.0
            for (i in lag until n) s += flux[i] * flux[i - lag]
            if (s > best) {
                best = s
                bestLag = lag
            }
        }
        if (bestLag == 0) return null
        return 6000.0 / bestLag
    }
}
