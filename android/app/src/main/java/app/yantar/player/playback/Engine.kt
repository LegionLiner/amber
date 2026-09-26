package app.yantar.player.playback

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.DynamicsProcessing
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Звуковой движок: две деки ExoPlayer с общей аудиосессией.
 *
 * Активная дека играет текущий трек; вторая заранее готовит следующий. Когда подходит
 * точка перехода, вторая дека стартует, громкости расходятся по кривой, и активной
 * становится она. Стык без паузы делается штатно внутри одной деки.
 *
 * Громкость деки = нормализация × кривая перехода × приглушение (аудиофокус) × сон-таймер.
 * Эквалайзер и предусилитель висят на общей аудиосессии (DynamicsProcessing), поэтому
 * действуют на обе деки сразу.
 *
 * Аудиофокусом управляет движок, а не деки: две ExoPlayer с собственным фокусом
 * выбивали бы друг друга посреди кроссфейда.
 */
class Engine(private val ctx: Context, private val events: Events) {

    interface Events {
        /** Дека стала активной: сессия и учёт переключаются на неё */
        fun onActiveChanged(from: ExoPlayer, to: ExoPlayer, reason: String)
        fun onOutputsChanged(headphonesConnected: Boolean)
    }

    class Tx(val type: String, val durationMs: Long, val curve: String, val outAtMs: Long?, val duckDb: Double)

    private val main = Handler(Looper.getMainLooper())
    private val am = ctx.getSystemService(AudioManager::class.java)
    val sessionId: Int = am.generateAudioSessionId()

    val decks: Array<ExoPlayer>
    var activeIndex = 0
        private set
    val active: ExoPlayer get() = decks[activeIndex]
    val aux: ExoPlayer get() = decks[1 - activeIndex]

    /* ------------------------------ настройки ------------------------------ */

    var crossfadeMode = "off" // off | crossfade | overlay | fadeOutIn
        private set
    private var crossfadeMs = 6000L
    private var crossfadeCurve = "equalPower"
    private var overlayDuckDb = -9.0
    private var smartTransitions = true
    private var skipFadeMs = 250L
    private var normMode = "off" // off | track | album | smart
    private var targetLufs = -14.0
    private var eqEnabled = false
    private var eqBands = DoubleArray(10)
    private var eqPreampDb = 0.0
    private var profiles = JSONObject()
    private var fx: DynamicsProcessing? = null
    private var preampDb = 0.0

    /* ------------------------------ состояние ------------------------------ */

    private var tail: ExoPlayer? = null
    private var txStart = 0L
    private var txDur = 0L
    private var txType = "crossfade"
    private var txCurve = "equalPower"
    private var txDuck = 0.35f
    private var fadeOutStart = 0L
    private var fadeOutDur = 0L
    private var manualFade: Float = 1f
    private var duck = 1f
    var sleepFactor = 1f
        set(v) {
            field = v
            applyVolumes()
        }
    private var abStart = -1L
    private var abEnd = -1L
    private var resumeOnFocusGain = false
    private var hasFocus = false
    private var preferredDevice: AudioDeviceInfo? = null

    init {
        decks = arrayOf(build(), build())
        am.registerAudioDeviceCallback(object : android.media.AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
                applyProfile()
                events.onOutputsChanged(added.any { kindOf(it) == "bluetooth" || kindOf(it) == "wired" })
            }

            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
                if (preferredDevice != null && removed.any { it.id == preferredDevice?.id }) setOutput(null)
                applyProfile()
                events.onOutputsChanged(false)
            }
        }, main)
        rebuildFx()
    }

    private fun build(): ExoPlayer {
        val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
        val p = ExoPlayer.Builder(ctx)
            .setAudioAttributes(attrs, false)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
        p.setAudioSessionId(sessionId)
        p.addListener(object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (p !== active) return
                if (playWhenReady) requestFocus() else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) abandonFocusLater()
                if (playWhenReady) startMonitor()
            }

            override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
                if (p === tail) {
                    // Хвост дотянул до конца трека раньше конца перехода: гасим
                    finishTail()
                    return
                }
                if (p === active) {
                    fadeOutStart = 0
                    applyVolumes()
                }
            }
        })
        return p
    }

    /* ------------------------------ аудиофокус ------------------------------ */

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                pauseAll()
                hasFocus = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                resumeOnFocusGain = active.playWhenReady
                pauseAll()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                duck = 0.25f
                applyVolumes()
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                duck = 1f
                applyVolumes()
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false
                    active.play()
                }
            }
        }
    }

    private val focusRequest: AudioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                .build(),
        )
        .setOnAudioFocusChangeListener(focusListener, main)
        .setWillPauseWhenDucked(false)
        .build()

    private val abandonTask = Runnable {
        if (!active.playWhenReady) {
            am.abandonAudioFocusRequest(focusRequest)
            hasFocus = false
        }
    }

    private fun requestFocus() {
        main.removeCallbacks(abandonTask)
        if (hasFocus) return
        hasFocus = am.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!hasFocus) Log.w(TAG, "audio focus denied")
    }

    private fun abandonFocusLater() {
        main.removeCallbacks(abandonTask)
        main.postDelayed(abandonTask, 30_000)
    }

    private fun pauseAll() {
        settle()
        active.pause()
    }

    /* ------------------------------ команды ------------------------------ */

    /** Любая команда пользователя сначала завершает идущий переход */
    fun settle() {
        if (tail != null) finishTail()
        fadeOutStart = 0
        manualFade = 1f
        main.removeCallbacks(fadeTask)
        applyVolumes()
    }

    fun forEachDeck(block: (ExoPlayer) -> Unit) = decks.forEach(block)

    fun play() {
        val p = active
        if (p.mediaItemCount == 0) return
        if (p.playbackState == Player.STATE_IDLE) p.prepare()
        if (p.playbackState == Player.STATE_ENDED) p.seekTo(p.currentMediaItemIndex, 0)
        requestFocus()
        applyVolumes()
        p.play()
        startMonitor()
    }

    fun pause() {
        settle()
        active.pause()
    }

    /** Переход к соседнему треку с коротким затуханием, чтобы ручной пропуск не резал звук */
    fun skip(next: Boolean) {
        settle()
        val p = active
        val can = if (next) p.hasNextMediaItem() else true
        if (!can) return
        val action = {
            if (next) p.seekToNextMediaItem() else p.seekToPrevious()
            play()
        }
        if (p.isPlaying && skipFadeMs > 0) fadeThen(action) else action()
    }

    private var fadeAction: (() -> Unit)? = null
    private var fadeStartAt = 0L
    private var fadingIn = false
    private val fadeTask = object : Runnable {
        override fun run() {
            val t = ((SystemClock.elapsedRealtime() - fadeStartAt).toFloat() / skipFadeMs).coerceIn(0f, 1f)
            manualFade = if (fadingIn) t else 1f - t
            applyVolumes()
            if (t < 1f) {
                main.postDelayed(this, 16)
                return
            }
            if (!fadingIn) {
                fadeAction?.invoke()
                fadeAction = null
                fadingIn = true
                fadeStartAt = SystemClock.elapsedRealtime()
                main.postDelayed(this, 16)
            } else {
                manualFade = 1f
                applyVolumes()
            }
        }
    }

    private fun fadeThen(action: () -> Unit) {
        fadeAction = action
        fadingIn = false
        fadeStartAt = SystemClock.elapsedRealtime()
        main.removeCallbacks(fadeTask)
        main.post(fadeTask)
    }

    fun setAbLoop(start: Long, end: Long) {
        abStart = start
        abEnd = end
        if (start >= 0 && end > start) startMonitor()
    }

    fun setPlaybackParams(speed: Float, pitch: Float) {
        val params = PlaybackParameters(speed.coerceIn(0.25f, 3f), pitch.coerceIn(0.25f, 3f))
        decks.forEach { it.playbackParameters = params }
    }

    val playbackParams: PlaybackParameters get() = active.playbackParameters

    /* ------------------------------ переходы ------------------------------ */

    private fun itemAt(p: ExoPlayer, index: Int): QItem? =
        if (index in 0 until p.mediaItemCount) QItem.fromMediaItem(p.getMediaItemAt(index)) else null

    /** Какой стык между двумя треками: своя настройка микса, умные правила или общие настройки */
    fun transitionFor(prev: QItem, next: QItem): Tx {
        next.transitionIn?.let { t ->
            return Tx(
                t.optString("type", "crossfade"),
                t.optLong("durationMs", crossfadeMs),
                t.optString("curve", crossfadeCurve),
                if (t.has("outAtMs")) t.optLong("outAtMs") else null,
                t.optDouble("duckDb", overlayDuckDb),
            )
        }
        if (crossfadeMode == "off") return Tx("gapless", 0, crossfadeCurve, null, 0.0)
        if (smartTransitions && prev.album != null && prev.album == next.album &&
            prev.trackNo != null && next.trackNo == prev.trackNo + 1
        ) {
            // Альбом по порядку: треки часто перетекают друг в друга
            return Tx("gapless", 0, crossfadeCurve, null, 0.0)
        }
        return Tx(crossfadeMode, crossfadeMs, crossfadeCurve, null, overlayDuckDb)
    }

    private fun effectiveEnd(p: ExoPlayer, item: QItem): Long {
        val dur = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: item.durationMs
        val trimmed = item.trimEndMs?.let { minOf(it, dur) } ?: dur
        val outro = Loudness.get(item.key)?.outroMs ?: 0L
        return trimmed - outro.coerceAtMost(15_000)
    }

    private fun cueIn(item: QItem, tx: Tx): Long {
        val intro = if (tx.type == "crossfade" || tx.type == "overlay") Loudness.get(item.key)?.introMs ?: 0L else 0L
        return maxOf(item.trimStartMs ?: 0L, intro.coerceAtMost(10_000))
    }

    private fun ensureAuxPrepared(nextIndex: Int, next: QItem, tx: Tx) {
        val b = aux
        if (b.mediaItemCount != active.mediaItemCount) return
        val sameItem = b.currentMediaItem?.mediaId == next.qid && b.currentMediaItemIndex == nextIndex
        val cue = cueIn(next, tx)
        if (!sameItem || b.playbackState == Player.STATE_IDLE || b.playbackState == Player.STATE_ENDED) {
            b.playWhenReady = false
            b.volume = 0f
            b.repeatMode = active.repeatMode
            b.seekTo(nextIndex, cue)
            b.prepare()
        }
    }

    private fun startTransition(tx: Tx) {
        val a = active
        val b = aux
        b.volume = 0f
        b.pauseAtEndOfMediaItems = false
        a.pauseAtEndOfMediaItems = true
        tail = a
        txStart = SystemClock.elapsedRealtime()
        txDur = tx.durationMs.coerceAtLeast(500)
        txType = tx.type
        txCurve = tx.curve
        txDuck = dbToLinear(tx.duckDb).toFloat()
        activeIndex = 1 - activeIndex
        b.play()
        events.onActiveChanged(a, b, "crossfade")
        applyVolumes()
    }

    private fun finishTail() {
        val t = tail ?: return
        tail = null
        t.pause()
        t.volume = 0f
        t.pauseAtEndOfMediaItems = false
        applyVolumes()
    }

    /* ------------------------------ монитор позиции ------------------------------ */

    private var monitorOn = false
    private val monitor = object : Runnable {
        override fun run() {
            val a = active
            val running = a.playWhenReady || tail != null
            if (!running) {
                monitorOn = false
                return
            }
            tick(a)
            main.postDelayed(this, 40)
        }
    }

    fun startMonitor() {
        if (monitorOn) return
        monitorOn = true
        main.post(monitor)
    }

    private fun tick(a: ExoPlayer) {
        if (tail != null) {
            applyVolumes()
            if (SystemClock.elapsedRealtime() - txStart >= txDur) finishTail()
            return
        }
        if (!a.isPlaying) return
        val pos = a.currentPosition
        if (abStart >= 0 && abEnd > abStart && pos >= abEnd) {
            a.seekTo(abStart)
            return
        }
        if (a.repeatMode == Player.REPEAT_MODE_ONE) return
        val cur = itemAt(a, a.currentMediaItemIndex) ?: return
        val nextIndex = a.nextMediaItemIndex
        if (nextIndex == C.INDEX_UNSET) return
        val next = itemAt(a, nextIndex) ?: return
        val tx = transitionFor(cur, next)
        if (tx.type == "gapless" || tx.type == "cut") return
        val end = effectiveEnd(a, cur)
        val dur = tx.durationMs.coerceAtMost(end / 2)
        val at = tx.outAtMs ?: (end - dur)
        if (tx.type == "fadeOutIn") {
            if (pos >= at && fadeOutStart == 0L) {
                fadeOutStart = SystemClock.elapsedRealtime()
                fadeOutDur = dur.coerceAtLeast(500)
            }
            if (fadeOutStart > 0) applyVolumes()
            return
        }
        if (pos >= at - 20_000) ensureAuxPrepared(nextIndex, next, tx)
        if (pos >= at) startTransition(Tx(tx.type, dur, tx.curve, tx.outAtMs, tx.duckDb))
    }

    /* ------------------------------ громкость ------------------------------ */

    private fun dbToLinear(db: Double) = 10.0.pow(db / 20)

    private fun gainOf(p: ExoPlayer): Float {
        val item = p.currentMediaItem?.let { QItem.fromMediaItem(it) } ?: return 1f
        val norm = Loudness.normalizationDb(item.key, normMode, targetLufs, item.sourceType == "album")
        val db = norm + item.gainDb - preampDb
        return dbToLinear(db).coerceIn(0.0, 1.0).toFloat()
    }

    private fun curveIn(t: Float): Float = when (txCurve) {
        "linear" -> t
        "sCurve" -> (0.5 - 0.5 * cos(PI * t)).toFloat()
        else -> sin(t * PI / 2).toFloat()
    }

    private fun curveOut(t: Float): Float = when (txCurve) {
        "linear" -> 1 - t
        "sCurve" -> (0.5 + 0.5 * cos(PI * t)).toFloat()
        else -> cos(t * PI / 2).toFloat()
    }

    fun applyVolumes() {
        val common = duck * sleepFactor * manualFade
        val a = active
        val t = tail
        if (t == null) {
            var f = 1f
            if (fadeOutStart > 0) {
                f = 1f - ((SystemClock.elapsedRealtime() - fadeOutStart).toFloat() / fadeOutDur).coerceIn(0f, 1f)
            }
            a.volume = gainOf(a) * f * common
            aux.volume = 0f
            return
        }
        val x = ((SystemClock.elapsedRealtime() - txStart).toFloat() / txDur).coerceIn(0f, 1f)
        val inF: Float
        val outF: Float
        if (txType == "overlay") {
            // B входит почти сразу, A отходит на второй план и уходит в конце
            inF = (x / 0.08f).coerceAtMost(1f)
            outF = when {
                x < 0.15f -> 1f - (1f - txDuck) * (x / 0.15f)
                x < 0.75f -> txDuck
                else -> txDuck * (1f - (x - 0.75f) / 0.25f)
            }
        } else {
            inF = curveIn(x)
            outF = curveOut(x)
        }
        a.volume = gainOf(a) * inF * common
        t.volume = gainOf(t) * outF * common
    }

    /* ------------------------------ эквалайзер ------------------------------ */

    val eqFrequencies = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)

    private fun rebuildFx() {
        val boost = if (normMode != "off") 6.0 else 0.0
        val needFx = eqEnabled || boost > 0
        try {
            if (!needFx) {
                fx?.release()
                fx = null
                preampDb = 0.0
                applyVolumes()
                return
            }
            val dp = fx ?: DynamicsProcessing(
                0,
                sessionId,
                DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                    2,
                    true, eqFrequencies.size,
                    false, 0,
                    false, 0,
                    true,
                ).build(),
            ).also { fx = it }
            for (i in eqFrequencies.indices) {
                // Полоса покрывает частоты до своей границы: берём середину до соседней полосы
                val cutoff = if (i < eqFrequencies.size - 1) sqrt(eqFrequencies[i] * eqFrequencies[i + 1]) else 20000.0
                val gain = if (eqEnabled) eqBands.getOrElse(i) { 0.0 } else 0.0
                dp.setPreEqBandAllChannelsTo(i, DynamicsProcessing.EqBand(true, cutoff.toFloat(), gain.toFloat()))
            }
            dp.setLimiterAllChannelsTo(DynamicsProcessing.Limiter(true, true, 0, 1f, 60f, 10f, -1f, 0f))
            dp.setInputGainAllChannelsTo((boost + if (eqEnabled) eqPreampDb else 0.0).toFloat())
            dp.enabled = true
            preampDb = boost
        } catch (e: Throwable) {
            Log.w(TAG, "DynamicsProcessing недоступен", e)
            fx = null
            preampDb = 0.0
        }
        applyVolumes()
    }

    /** Настройки звука из интерфейса (формат AudioSettings в src/native/types.ts) */
    fun setSettings(s: JSONObject) {
        s.optJSONObject("crossfade")?.let { c ->
            crossfadeMode = c.optString("mode", crossfadeMode)
            crossfadeMs = c.optLong("durationMs", crossfadeMs)
            crossfadeCurve = c.optString("curve", crossfadeCurve)
            overlayDuckDb = c.optDouble("duckDb", overlayDuckDb)
            smartTransitions = c.optBoolean("smart", smartTransitions)
            skipFadeMs = c.optLong("skipFadeMs", skipFadeMs)
        }
        s.optJSONObject("normalization")?.let { n ->
            normMode = n.optString("mode", normMode)
            targetLufs = n.optDouble("targetLufs", targetLufs)
        }
        s.optJSONObject("eq")?.let { applyEqJson(it) }
        s.optJSONObject("profiles")?.let { profiles = it }
        applyProfile()
        rebuildFx()
    }

    private var defaultEq: JSONObject? = null

    private fun applyEqJson(e: JSONObject) {
        defaultEq = e
        setEq(e)
    }

    private fun setEq(e: JSONObject) {
        eqEnabled = e.optBoolean("enabled", false)
        eqPreampDb = e.optDouble("preampDb", 0.0)
        val arr = e.optJSONArray("bands")
        eqBands = DoubleArray(10) { i -> arr?.optDouble(i, 0.0) ?: 0.0 }
    }

    /** Профиль под текущее устройство вывода; если его нет, общий эквалайзер */
    private fun applyProfile() {
        val name = outputName()
        val p = profiles.optJSONObject(name)?.optJSONObject("eq")
        if (p != null) setEq(p) else defaultEq?.let { setEq(it) }
        rebuildFx()
    }

    /* ------------------------------ устройства вывода ------------------------------ */

    fun outputs(): List<AudioDeviceInfo> {
        val wanted = mutableSetOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
        )
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            wanted += AudioDeviceInfo.TYPE_BLE_HEADSET
            wanted += AudioDeviceInfo.TYPE_BLE_SPEAKER
        }
        return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { it.type in wanted }
    }

    fun setOutput(id: Int?) {
        val dev = if (id == null) null else outputs().firstOrNull { it.id == id }
        preferredDevice = dev
        decks.forEach { it.setPreferredAudioDevice(dev) }
        applyProfile()
    }

    val preferredOutputId: Int? get() = preferredDevice?.id

    fun kindOf(d: AudioDeviceInfo): String = when (d.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "usb"
        else -> "bluetooth"
    }

    /** Куда сейчас идёт звук: bt:<имя>, wired, usb или speaker */
    fun outputName(): String {
        preferredDevice?.let { d -> return if (kindOf(d) == "bluetooth") "bt:${d.productName}" else kindOf(d) }
        val outs = outputs()
        outs.firstOrNull { kindOf(it) == "bluetooth" }?.let { return "bt:${it.productName}" }
        if (outs.any { kindOf(it) == "wired" }) return "wired"
        if (outs.any { kindOf(it) == "usb" }) return "usb"
        return "speaker"
    }

    fun release() {
        fx?.release()
        decks.forEach { it.release() }
    }

    companion object {
        private const val TAG = "Engine"
    }
}
