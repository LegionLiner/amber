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
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import org.json.JSONObject
import kotlin.math.PI
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
    /** Переход объявлен, но B ещё не зазвучал: A играет в полную, B молчит */
    private var txPending = false
    private var txPendingSince = 0L
    private var txCue = 0L
    /** Сколько обычно заводится вторая дека (мерим на каждом переходе): переход объявляем на столько раньше */
    private var startLatencyMs = 250L
    private var txDur = 0L
    private var txType = "crossfade"
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

    /** Кривые переходов в самом звуке каждой деки (см. Fader) */
    private val faders = arrayOf(Fader(), Fader())

    private fun faderOf(p: ExoPlayer): Fader = faders[if (p === decks[0]) 0 else 1]

    /** Часы идущего перехода: сколько уже прозвучал входящий трек */
    private var txClock: Fader.Clock? = null

    init {
        decks = arrayOf(build(faders[0]), build(faders[1]))
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

    private fun build(fader: Fader): ExoPlayer {
        val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
        val renderers = object : DefaultRenderersFactory(ctx) {
            override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
                DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf(fader))
                    .build()
        }
        val p = ExoPlayer.Builder(ctx, renderers)
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
                    if (fadeOutStart > 0) faderOf(p).clear()
                    fadeOutStart = 0
                    applyVolumes()
                    // Точки входа трека держит движок (без ClippingConfiguration): новый трек — с его начала
                    if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
                        val start = startOf(p, p.currentMediaItemIndex)
                        if (start > 0 && p.currentPosition < start - 50) p.seekTo(start)
                    }
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
        if (fadeOutStart > 0) faderOf(active).clear()
        fadeOutStart = 0
        // Недоигранная кривая входа (переход прервали командой) — сразу в полную громкость
        if (faderOf(active).plan != null) faderOf(active).clear()
        main.removeCallbacks(fadeTask)
        manualFade = 1f
        // Затухание прервали новой командой: то, ради чего оно шло (пропуск, смена скорости), всё равно выполняем
        fadeAction?.let {
            fadeAction = null
            it()
        }
        applyVolumes()
    }

    fun forEachDeck(block: (ExoPlayer) -> Unit) = decks.forEach(block)

    fun play() {
        val p = active
        if (p.mediaItemCount == 0) return
        if (p.playbackState == Player.STATE_IDLE) p.prepare()
        if (p.playbackState == Player.STATE_ENDED) p.seekTo(p.currentMediaItemIndex, startOf(p, p.currentMediaItemIndex))
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
        val level = manualFade
        settle()
        val p = active
        val can = if (next) p.hasNextMediaItem() else true
        if (!can) return
        val action = {
            val cur = p.currentMediaItemIndex
            val target = when {
                next -> p.nextMediaItemIndex
                // «Назад» после трёх секунд — в начало этого же трека
                p.currentPosition - startOf(p, cur) > 3000 -> cur
                p.previousMediaItemIndex != C.INDEX_UNSET -> p.previousMediaItemIndex
                else -> cur
            }
            if (target != C.INDEX_UNSET) p.seekTo(target, startOf(p, target))
            play()
        }
        if (p.isPlaying && skipFadeMs > 0) {
            manualFade = level
            fadeThen(skipFadeMs, 0, skipFadeMs, action)
        } else {
            action()
        }
    }

    /** Переход на трек очереди по номеру (тап в очереди, свайп обложки) — с тем же коротким затуханием */
    fun jumpTo(index: Int, play: Boolean) {
        val level = manualFade
        settle()
        val p = active
        if (index !in 0 until p.mediaItemCount) return
        val action = {
            p.seekTo(index, startOf(p, index))
            if (play) play()
        }
        if (p.isPlaying && skipFadeMs > 0) {
            manualFade = level
            fadeThen(skipFadeMs, 0, skipFadeMs, action)
        } else {
            action()
        }
    }

    private var fadeAction: (() -> Unit)? = null
    private var fadeStartAt = 0L
    private var fadePhase = 0 // 0 — уход, 1 — тишина, 2 — возврат
    private var fadeOutMs = 0L
    private var fadeHoldMs = 0L
    private var fadeInMs = 0L
    private var fadeFrom = 1f
    private val fadeTask = object : Runnable {
        override fun run() {
            val now = SystemClock.elapsedRealtime()
            when (fadePhase) {
                0 -> {
                    val t = ((now - fadeStartAt).toFloat() / fadeOutMs.coerceAtLeast(1)).coerceIn(0f, 1f)
                    manualFade = fadeFrom * (1f - t)
                    applyVolumes()
                    if (t < 1f) {
                        main.postDelayed(this, 16)
                        return
                    }
                    val action = fadeAction
                    fadeAction = null
                    action?.invoke()
                    fadePhase = 1
                    fadeStartAt = now
                    main.postDelayed(this, fadeHoldMs.coerceAtLeast(16))
                }
                1 -> {
                    fadePhase = 2
                    fadeStartAt = now
                    main.post(this)
                }
                else -> {
                    val t = ((now - fadeStartAt).toFloat() / fadeInMs.coerceAtLeast(1)).coerceIn(0f, 1f)
                    // Возврат по синусу: на слух ровнее линейного
                    manualFade = sin(t * PI / 2).toFloat()
                    applyVolumes()
                    if (t < 1f) main.postDelayed(this, 16) else manualFade = 1f
                }
            }
        }
    }

    /** Увести звук в ноль за outMs, выполнить action, подождать holdMs и вернуть за inMs */
    private fun fadeThen(outMs: Long, holdMs: Long, inMs: Long, action: () -> Unit) {
        fadeAction = action
        // Новое затухание посреди прошлого начинается с текущей громкости, без скачка вверх
        fadeFrom = manualFade
        fadePhase = 0
        fadeOutMs = outMs
        fadeHoldMs = holdMs
        fadeInMs = inMs
        fadeStartAt = SystemClock.elapsedRealtime()
        main.removeCallbacks(fadeTask)
        main.post(fadeTask)
    }

    fun setAbLoop(start: Long, end: Long) {
        abStart = start
        abEnd = end
        if (start >= 0 && end > start) startMonitor()
    }

    /**
     * Скорость и тон. ExoPlayer при смене параметров досливает старый буфер Sonic и начинает новый —
     * на стыке слышен щелчок. Поэтому звук коротко уходит в ноль, параметры меняются, и громкость
     * возвращается, когда стык (он ещё сидит в буфере AudioTrack, ~250 мс) уже проигран в тишине.
     */
    fun setPlaybackParams(speed: Float, pitch: Float) {
        val params = PlaybackParameters(speed.coerceIn(0.25f, 3f), pitch.coerceIn(0.25f, 3f))
        if (params == active.playbackParameters) return
        val apply = { decks.forEach { it.playbackParameters = params } }
        if (active.isPlaying && fadeAction == null) fadeThen(60, 300, 160, apply) else apply()
    }

    val playbackParams: PlaybackParameters get() = active.playbackParameters

    /** Сколько ещё идёт переход между треками (для анимации в интерфейсе), 0 — перехода нет */
    val transitionLeftMs: Long
        get() = if (tail == null) 0 else (txDur - (txClock?.playedUs ?: 0L) / 1000).coerceAtLeast(0)

    /* ------------------------------ переходы ------------------------------ */

    private fun itemAt(p: ExoPlayer, index: Int): QItem? =
        if (index in 0 until p.mediaItemCount) QItem.fromMediaItem(p.getMediaItemAt(index)) else null

    /** Откуда начинать трек: точка входа микса или обрезка начала (позиции везде абсолютные, как в файле) */
    fun startOf(p: ExoPlayer, index: Int): Long = itemAt(p, index)?.trimStartMs ?: 0L

    /**
     * Трек сменился по воле движка (конец обрезки, затухание): для учёта это дослушанный трек,
     * а не пропуск. PlayerHub забирает флаг в onMediaItemTransition.
     */
    private var advancing = false

    fun consumeAdvancing(): Boolean = advancing.also { advancing = false }

    private fun advance(p: ExoPlayer, index: Int) {
        advancing = true
        p.seekTo(index, startOf(p, index))
    }

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
        // В миксе точка входа выбрана руками — ровно с неё, без пропуска тишины
        if (item.transitionIn != null) return item.trimStartMs ?: 0L
        val intro = if (tx.type == "crossfade" || tx.type == "overlay") Loudness.get(item.key)?.introMs ?: 0L else 0L
        return maxOf(item.trimStartMs ?: 0L, intro.coerceAtMost(10_000))
    }

    private fun txLength(tx: Tx): Long =
        if (tx.type == "cut" || tx.type == "gapless") tx.durationMs.coerceAtLeast(30) else tx.durationMs.coerceAtLeast(500)

    /**
     * Следующий трек заранее готовится во второй деке. Кривая входа ставится ДО подготовки:
     * ExoPlayer ещё на паузе успевает обработать первые сотни мс звука, и они должны пройти
     * уже с начала кривой, а не в полную громкость.
     */
    private fun ensureAuxPrepared(nextIndex: Int, next: QItem, tx: Tx) {
        val b = aux
        if (b.mediaItemCount != active.mediaItemCount) return
        val sameItem = b.currentMediaItem?.mediaId == next.qid && b.currentMediaItemIndex == nextIndex
        val cue = cueIn(next, tx)
        val fader = faderOf(b)
        val armed = fader.plan?.let { it.role == Fader.Role.IN && it.type == tx.type && it.durUs == txLength(tx) * 1000 } == true
        if (!sameItem || !armed || b.playbackState == Player.STATE_IDLE || b.playbackState == Player.STATE_ENDED) {
            b.playWhenReady = false
            fader.armIn(tx.type, tx.curve, txLength(tx), dbToLinear(tx.duckDb).toFloat())
            b.repeatMode = active.repeatMode
            // Перемотка сбрасывает уже обработанный звук: он пройдёт заново, по новой кривой
            b.seekTo(nextIndex, cue)
            b.prepare()
        }
    }

    private fun startTransition(tx: Tx) {
        val a = active
        val b = aux
        val len = txLength(tx)
        val duckGain = dbToLinear(tx.duckDb).toFloat()
        val bFader = faderOf(b)
        val clock = bFader.plan?.takeIf { it.role == Fader.Role.IN }?.clock ?: bFader.armIn(tx.type, tx.curve, len, duckGain)
        faderOf(a).armOut(clock, tx.type, tx.curve, len, duckGain)
        clock.playing = true
        txClock = clock
        b.pauseAtEndOfMediaItems = false
        a.pauseAtEndOfMediaItems = true
        tail = a
        // Кривая пойдёт, когда B реально зазвучит: старт деки занимает от десятков мс до полусекунды,
        // и если начать сразу, A успевает притихнуть, а B ещё молчит — слышен провал
        txPending = true
        txPendingSince = SystemClock.elapsedRealtime()
        txCue = b.currentPosition
        txDur = len
        txType = tx.type
        activeIndex = 1 - activeIndex
        b.play()
        events.onActiveChanged(a, b, "crossfade")
        applyVolumes()
    }

    private fun finishTail() {
        val t = tail ?: return
        tail = null
        txPending = false
        txClock = null
        t.pause()
        t.pauseAtEndOfMediaItems = false
        faderOf(t).clear()
        // Кривая входа доиграна (или переход прервали) — дальше новый трек звучит без неё
        faderOf(active).clear()
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
            val now = SystemClock.elapsedRealtime()
            if (txPending) {
                // B пошёл, когда позиция сдвинулась от точки входа; на всякий случай не ждём дольше 1,5 с
                val started = a.isPlaying && a.currentPosition >= txCue + 30
                if (started || now - txPendingSince > 1500) {
                    txPending = false
                    val took = now - txPendingSince
                    if (started) startLatencyMs = ((startLatencyMs + took) / 2).coerceIn(0, 800)
                    Log.d(TAG, "переход: B зазвучал через $took мс${if (started) "" else " (не дождались)"}, упреждение теперь $startLatencyMs мс")
                }
            }
            val played = (txClock?.playedUs ?: 0L) / 1000
            // Страховка: B так и не пошёл (ошибка файла) — не держим A вечно
            if (played >= txDur || (played == 0L && now - txPendingSince > 5000)) {
                Log.d(TAG, "переход окончен: $txType $txDur мс")
                finishTail()
            }
            return
        }
        if (!a.isPlaying) return
        val pos = a.currentPosition
        if (abStart >= 0 && abEnd > abStart && pos >= abEnd) {
            a.seekTo(abStart)
            return
        }
        val cur = itemAt(a, a.currentMediaItemIndex) ?: return
        // Обрезка конца: дальше трек не звучит
        val trimEnd = cur.trimEndMs
        if (a.repeatMode == Player.REPEAT_MODE_ONE) {
            if (trimEnd != null && pos >= trimEnd) a.seekTo(startOf(a, a.currentMediaItemIndex))
            return
        }
        val nextIndex = a.nextMediaItemIndex
        if (nextIndex == C.INDEX_UNSET) {
            if (trimEnd != null && pos >= trimEnd) {
                a.pause()
                a.seekTo(startOf(a, a.currentMediaItemIndex))
            }
            return
        }
        val next = itemAt(a, nextIndex) ?: return
        val tx = transitionFor(cur, next)
        if (tx.type == "gapless" || tx.type == "cut") {
            // Встык внутри одной деки ExoPlayer делает сам, но только от конца файла к его началу.
            // Если у стыка есть точка выхода, обрезка конца или точка входа у следующего — стык делают две деки
            val len = a.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: cur.durationMs
            val at = tx.outAtMs ?: trimEnd ?: if ((next.trimStartMs ?: 0) > 0) len - 60 else return
            if (pos >= at - 20_000) ensureAuxPrepared(nextIndex, next, tx)
            if (pos >= at - startLatencyMs) startTransition(Tx(tx.type, 40, "linear", tx.outAtMs, 0.0))
            return
        }
        val end = effectiveEnd(a, cur)
        val dur = tx.durationMs.coerceAtMost(end / 2)
        val at = tx.outAtMs ?: (end - dur)
        if (tx.type == "fadeOutIn") {
            if (pos >= at && fadeOutStart == 0L) {
                fadeOutStart = SystemClock.elapsedRealtime()
                fadeOutDur = dur.coerceAtLeast(500)
                faderOf(a).armFadeOut(fadeOutDur)
            }
            // Затихло — сразу следующий с его точки входа, а не тишина до конца файла
            if (fadeOutStart > 0 && faderOf(a).silent) advance(a, nextIndex)
            return
        }
        if (pos >= at - 20_000) ensureAuxPrepared(nextIndex, next, tx)
        // Запуск с упреждением на время завода деки: слышимый переход начнётся ровно в точке at
        if (pos >= at - startLatencyMs) startTransition(Tx(tx.type, dur, tx.curve, tx.outAtMs, tx.duckDb))
    }

    /* ------------------------------ громкость ------------------------------ */

    private fun dbToLinear(db: Double) = 10.0.pow(db / 20)

    private fun gainOf(p: ExoPlayer): Float {
        val item = p.currentMediaItem?.let { QItem.fromMediaItem(it) } ?: return 1f
        val norm = Loudness.normalizationDb(item.key, normMode, targetLufs, item.sourceType == "album")
        val db = norm + item.gainDb - preampDb
        return dbToLinear(db).coerceIn(0.0, 1.0).toFloat()
    }

    /**
     * Громкость дек: нормализация × приглушение (аудиофокус) × сон-таймер × короткое затухание при пропуске.
     * Кривые переходов сюда не входят — их ведут процессоры Fader прямо в звуке.
     */
    fun applyVolumes() {
        val common = duck * sleepFactor * manualFade
        val a = active
        val t = tail
        a.volume = gainOf(a) * common
        if (t != null) t.volume = gainOf(t) * common else aux.volume = 0f
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
