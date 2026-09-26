package app.yantar.player.playback

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import app.yantar.player.analysis.Analyzer
import app.yantar.player.db.Database
import app.yantar.player.tracking.PlayTracker
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Сердце воспроизведения. Живёт, пока жив процесс, и не зависит от того, открыт ли интерфейс.
 *
 * - звук делает Engine (две деки, переходы, громкость, эквалайзер);
 * - очередь = плейлист активной деки, у каждого MediaItem в tag лежит QItem; вторая дека держит копию;
 * - ревизия очереди (rev) растёт при каждом изменении: по ней интерфейс понимает, что его копия устарела;
 * - снимок очереди и позиции сохраняется в файлы, после перезапуска всё восстанавливается;
 * - события активной деки идут в PlayTracker (учёт) и слушателям (плагин → интерфейс).
 *
 * Все методы вызываются в главном потоке.
 */
object PlayerHub {
    private const val TAG = "PlayerHub"

    interface Listener {
        fun onState(state: JSONObject)
        fun onPlayLogged(event: JSONObject)
        fun onNotificationAction(event: JSONObject)
        fun onOutputs(event: JSONObject)
        fun onAnalysis(event: JSONObject)
        fun onQueueLow(event: JSONObject)
    }

    val listeners = CopyOnWriteArraySet<Listener>()

    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())
    private var initialized = false
    private var inEdit = false
    private var favoriteCurrent = false
    private var sleepAt = 0L
    private var sleepEndOfTrack = false
    private var autoResume = false
    private var pausedAt = 0L

    var engine: Engine? = null
        private set
    lateinit var tracker: PlayTracker
        private set
    lateinit var analyzer: Analyzer
        private set
    var rev = 0
        private set

    /** Сессию создаёт PlaybackService; нужна для уведомления и смены деки при кроссфейде */
    var session: MediaSession? = null
        set(value) {
            field = value
            if (value != null) updateButtons()
        }

    fun init(ctx: Context) {
        if (initialized) return
        initialized = true
        app = ctx.applicationContext
        Database.init(app)
        tracker = PlayTracker(app)
        tracker.onLogged = { e ->
            val j = JSONObject()
                .put("id", e.id)
                .put("key", e.key)
                .put("startedAt", e.startedAt)
                .put("listenedMs", e.listenedMs)
                .put("endReason", e.endReason)
                .put("counted", e.counted)
            listeners.forEach { it.onPlayLogged(j) }
        }
        tracker.init({ engine?.active?.currentPosition ?: 0L }) { engine?.outputName() ?: "unknown" }
        analyzer = Analyzer(app) { done, total, key ->
            main.post {
                val j = JSONObject().put("done", done).put("total", total).put("key", key)
                listeners.forEach { it.onAnalysis(j) }
            }
        }
        Database.io.execute { Loudness.load() }
    }

    /** Движок создаётся лениво; при создании восстанавливается последняя очередь */
    private fun engine(): Engine {
        engine?.let { return it }
        val e = Engine(app, engineEvents)
        engine = e
        e.decks.forEach { deck -> deck.addListener(DeckListener(deck)) }
        restore(e)
        return e
    }

    fun player(): ExoPlayer = engine().active

    private val engineEvents = object : Engine.Events {
        override fun onActiveChanged(from: ExoPlayer, to: ExoPlayer, reason: String) {
            // Кроссфейд: прошлый трек закончился переходом, новый уже звучит
            tracker.finish("crossfade")
            session?.player = to
            val q = current()
            if (to.isPlaying || to.playWhenReady) {
                tracker.onPlayingChanged(true, q?.key, q?.durationMs ?: 0, q?.sourceType, q?.sourceId)
            }
            refreshFavorite()
            savePosition()
            emitState()
            checkQueueLow()
            // Следующие треки после кроссфейда тоже должны быть проанализированы к своему стыку
            prefetchAnalysis()
        }

        override fun onOutputsChanged(headphonesConnected: Boolean) {
            listeners.forEach { it.onOutputs(outputsJson()) }
            // Автопродолжение: наушники подключились вскоре после паузы
            val p = engine?.active ?: return
            if (autoResume && headphonesConnected && !p.playWhenReady && p.mediaItemCount > 0 &&
                System.currentTimeMillis() - pausedAt < 3 * 3600_000L
            ) {
                main.postDelayed({ play() }, 1200)
            }
        }
    }

    fun current(): QItem? {
        val p = engine?.active ?: return null
        if (p.mediaItemCount == 0) return null
        return p.currentMediaItem?.let { QItem.fromMediaItem(it) }
    }

    fun queue(): List<QItem> {
        val p = engine?.active ?: return emptyList()
        return (0 until p.mediaItemCount).map { QItem.fromMediaItem(p.getMediaItemAt(it)) }
    }

    /* ------------------------------ события активной деки ------------------------------ */

    private class DeckListener(private val deck: ExoPlayer) : Player.Listener {
        private val isActive get() = engine?.active === deck

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isActive) return
            val q = current()
            tracker.onPlayingChanged(isPlaying, q?.key, q?.durationMs ?: 0, q?.sourceType, q?.sourceId)
            if (isPlaying) {
                ensureService()
                main.removeCallbacks(positionTask)
                main.postDelayed(positionTask, 15_000)
            } else {
                pausedAt = System.currentTimeMillis()
                savePosition()
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (!isActive) return
            if (sleepEndOfTrack && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                sleepEndOfTrack = false
                deck.pauseAtEndOfMediaItems = false
            }
            val why = when (reason) {
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "completed"
                Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "skipped"
                else -> "replaced"
            }
            tracker.finish(why)
            if (deck.isPlaying) {
                val q = current()
                tracker.onPlayingChanged(true, q?.key, q?.durationMs ?: 0, q?.sourceType, q?.sourceId)
            }
            refreshFavorite()
            savePosition()
            checkQueueLow()
            prefetchAnalysis()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (!isActive) return
            if (playbackState == Player.STATE_ENDED) tracker.finish("completed")
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            if (!isActive) return
            // «Назад» в начало того же трека после 3 секунд: новое прослушивание
            if (reason == Player.DISCONTINUITY_REASON_SEEK &&
                oldPosition.mediaItemIndex == newPosition.mediaItemIndex &&
                newPosition.positionMs < 1000 && oldPosition.positionMs > 3000 && tracker.hasLive()
            ) {
                tracker.finish("replaced")
                if (deck.isPlaying) {
                    val q = current()
                    tracker.onPlayingChanged(true, q?.key, q?.durationMs ?: 0, q?.sourceType, q?.sourceId)
                }
            }
        }

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (!isActive) return
            if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED && !inEdit) {
                // Очередь поменял кто-то снаружи (системная карточка «продолжить», часы): копируем во вторую деку
                val e = engine ?: return
                val items = (0 until deck.mediaItemCount).map { deck.getMediaItemAt(it) }
                inEdit = true
                try {
                    e.aux.setMediaItems(items, false)
                } finally {
                    inEdit = false
                }
                rev++
                saveQueueSoon()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!isActive) return
            Log.w(TAG, "playback error", error)
            tracker.finish("error")
            // Битый файл не должен останавливать всю очередь
            if (deck.hasNextMediaItem()) {
                deck.seekToNextMediaItem()
                deck.prepare()
                deck.play()
            }
        }

        override fun onEvents(player: Player, events: Player.Events) {
            if (!isActive) return
            if (events.containsAny(
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_PLAYBACK_STATE_CHANGED,
                    Player.EVENT_PLAY_WHEN_READY_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_POSITION_DISCONTINUITY,
                    Player.EVENT_REPEAT_MODE_CHANGED,
                    Player.EVENT_TIMELINE_CHANGED,
                    Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
                )
            ) {
                emitState()
            }
        }
    }

    private fun emitState() {
        val s = stateJson()
        listeners.forEach { it.onState(s) }
    }

    /* ------------------------------ состояние ------------------------------ */

    fun stateJson(): JSONObject {
        val p = engine?.active
        val state = p?.playbackState ?: Player.STATE_IDLE
        val dur = p?.duration ?: C.TIME_UNSET
        return JSONObject()
            .put("rev", rev)
            .put("index", if (p == null || p.mediaItemCount == 0) -1 else p.currentMediaItemIndex)
            .put("playing", p != null && p.playWhenReady && (state == Player.STATE_READY || state == Player.STATE_BUFFERING))
            .put("buffering", state == Player.STATE_BUFFERING)
            .put("positionMs", p?.currentPosition ?: 0L)
            .put("positionAt", System.currentTimeMillis())
            .put("durationMs", if (dur == C.TIME_UNSET || dur <= 0) (current()?.durationMs ?: 0L) else dur)
            .put("repeat", repeatName(p?.repeatMode ?: Player.REPEAT_MODE_OFF))
            .put("sleepAt", sleepAt)
            .put("sleepEndOfTrack", sleepEndOfTrack)
            .put("speed", p?.playbackParameters?.speed ?: 1f)
            .put("pitch", p?.playbackParameters?.pitch ?: 1f)
            .put("output", engine?.outputName() ?: "speaker")
            .put("transitionMs", engine?.transitionLeftMs ?: 0L)
    }

    fun snapshotJson(): JSONObject {
        engine()
        val s = stateJson()
        val arr = JSONArray()
        queue().forEach { arr.put(it.json) }
        return s.put("queue", arr)
    }

    private fun repeatName(mode: Int) = when (mode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
    }

    /* ------------------------------ команды ------------------------------ */

    private inline fun edit(block: (Engine) -> Unit): Int {
        val e = engine()
        e.settle()
        inEdit = true
        try {
            block(e)
        } finally {
            inEdit = false
        }
        rev++
        saveQueueSoon()
        emitState()
        prefetchAnalysis()
        return rev
    }

    fun setQueue(items: List<QItem>, index: Int, positionMs: Long, play: Boolean): Int {
        tracker.finish("replaced")
        val r = edit { e ->
            val start = index.coerceIn(0, maxOf(0, items.size - 1))
            val active = e.active
            e.forEachDeck { d ->
                d.setMediaItems(items.map { it.toMediaItem() }, start, positionMs)
                if (d !== active) d.stop()
            }
            active.prepare()
        }
        if (play) play()
        return r
    }

    fun editQueue(edits: JSONArray): Int = edit { e ->
        for (i in 0 until edits.length()) {
            val ed = edits.getJSONObject(i)
            when (ed.optString("op")) {
                "insert" -> {
                    val items = parseItems(ed.optJSONArray("items"))
                    e.forEachDeck { d ->
                        val at = ed.optInt("at").coerceIn(0, d.mediaItemCount)
                        d.addMediaItems(at, items.map { it.toMediaItem() })
                    }
                }
                "move" -> e.forEachDeck { d ->
                    val n = d.mediaItemCount
                    val from = ed.optInt("from")
                    val to = ed.optInt("to")
                    if (from in 0 until n && to in 0 until n) d.moveMediaItem(from, to)
                }
                "remove" -> e.forEachDeck { d ->
                    val idx = ed.optInt("index")
                    if (idx in 0 until d.mediaItemCount) d.removeMediaItem(idx)
                }
                "replaceUpcoming" -> {
                    val items = parseItems(ed.optJSONArray("items"))
                    val cur = e.active.currentMediaItemIndex
                    e.forEachDeck { d ->
                        if (cur + 1 < d.mediaItemCount) d.removeMediaItems(cur + 1, d.mediaItemCount)
                        d.addMediaItems(items.map { it.toMediaItem() })
                    }
                }
            }
        }
        val a = e.active
        if (a.playbackState == Player.STATE_IDLE && a.mediaItemCount > 0) a.prepare()
    }

    fun parseItems(arr: JSONArray?): List<QItem> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::QItem) }
    }

    fun play() {
        ensureService()
        engine().play()
    }

    fun skipTo(index: Int, play: Boolean) {
        val e = engine()
        if (index !in 0 until e.active.mediaItemCount) return
        if (play) ensureService()
        e.jumpTo(index, play)
    }

    /**
     * Файлы получили новые отпечатки (KeyAliases): переименовать ключи у треков очереди в памяти,
     * иначе прослушивания записались бы под старым ключом.
     */
    fun remapKeys(map: Map<String, String>) {
        if (map.isEmpty()) return
        main.post {
            val e = engine ?: return@post
            var changed = false
            e.forEachDeck { deck ->
                for (i in 0 until deck.mediaItemCount) {
                    val q = QItem.fromMediaItem(deck.getMediaItemAt(i))
                    map[q.key]?.let {
                        q.rekey(it)
                        changed = true
                    }
                }
            }
            if (changed) saveQueueSoon()
        }
    }

    fun control(action: String) {
        val e = engine()
        when (action) {
            "play" -> play()
            "pause" -> e.pause()
            "toggle" -> if (e.active.playWhenReady && e.active.playbackState != Player.STATE_ENDED) e.pause() else play()
            "next" -> e.skip(next = true)
            "prev" -> e.skip(next = false)
            "stop" -> {
                tracker.finish("stopped")
                e.pause()
                e.active.seekTo(0)
            }
        }
    }

    fun seekTo(ms: Long) {
        val e = engine()
        e.settle()
        e.active.seekTo(ms.coerceAtLeast(0))
    }

    fun setRepeat(mode: String) {
        val m = when (mode) {
            "all" -> Player.REPEAT_MODE_ALL
            "one" -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
        engine().forEachDeck { it.repeatMode = m }
        savePosition()
    }

    fun setAbLoop(start: Long, end: Long) = engine().setAbLoop(start, end)

    fun setPlaybackParams(speed: Float, pitch: Float) {
        engine().setPlaybackParams(speed, pitch)
        emitState()
    }

    fun setAudioSettings(s: JSONObject) {
        autoResume = s.optBoolean("autoResume", autoResume)
        engine().setSettings(s)
    }

    fun outputsJson(): JSONObject {
        val e = engine()
        val arr = JSONArray()
        for (d in e.outputs()) {
            arr.put(
                JSONObject()
                    .put("id", d.id)
                    .put("name", d.productName?.toString() ?: "")
                    .put("kind", e.kindOf(d)),
            )
        }
        return JSONObject()
            .put("devices", arr)
            .put("preferred", e.preferredOutputId ?: JSONObject.NULL)
            .put("current", e.outputName())
    }

    fun setOutput(id: Int?) {
        engine().setOutput(id)
        listeners.forEach { it.onOutputs(outputsJson()) }
        emitState()
    }

    fun analyze(keys: List<String>, urgent: Boolean) = analyzer.enqueue(keys, urgent)

    fun setUiVisible(visible: Boolean) {
        analyzer.uiVisible = visible
    }

    /** Ближайшие треки очереди анализируются вне очереди: к их стыку данные уже будут */
    private fun prefetchAnalysis() {
        val p = engine?.active ?: return
        val from = p.currentMediaItemIndex
        val keys = (from until minOf(p.mediaItemCount, from + 4)).mapNotNull { idx ->
            val q = QItem.fromMediaItem(p.getMediaItemAt(idx))
            if (Loudness.get(q.key)?.lufs == null) q.key else null
        }
        if (keys.isNotEmpty()) analyzer.enqueue(keys, true)
    }

    /** Для радио: интерфейсу пора подложить треков */
    private fun checkQueueLow() {
        val p = engine?.active ?: return
        val left = p.mediaItemCount - p.currentMediaItemIndex - 1
        val src = current()?.sourceType
        if (src == "radio" && left <= 10) {
            val j = JSONObject().put("left", left)
            listeners.forEach { it.onQueueLow(j) }
        }
    }

    private fun ensureService() {
        if (session != null) return
        try {
            app.startService(Intent(app, PlaybackService::class.java))
        } catch (e: Exception) {
            Log.w(TAG, "startService failed", e)
        }
    }

    /* ------------------------------ сон-таймер ------------------------------ */

    private val sleepTask = Runnable { fadeOutAndPause() }

    /** minutes > 0: остановить через N минут с затуханием; endOfTrack: после текущего трека; иначе выключить */
    fun setSleepTimer(minutes: Int, endOfTrack: Boolean) {
        main.removeCallbacks(sleepTask)
        sleepAt = 0
        sleepEndOfTrack = endOfTrack
        player().pauseAtEndOfMediaItems = endOfTrack
        if (!endOfTrack && minutes > 0) {
            sleepAt = System.currentTimeMillis() + minutes * 60_000L
            main.postDelayed(sleepTask, minutes * 60_000L)
        }
        emitState()
    }

    /** 15 секунд плавного затухания, потом пауза и возврат громкости */
    private fun fadeOutAndPause() {
        val e = engine ?: return
        val steps = 30
        var i = 0
        val step = object : Runnable {
            override fun run() {
                i++
                e.sleepFactor = (1f - i.toFloat() / steps).coerceAtLeast(0f)
                if (i < steps) {
                    main.postDelayed(this, 500)
                } else {
                    e.pause()
                    e.sleepFactor = 1f
                    sleepAt = 0
                    emitState()
                }
            }
        }
        main.post(step)
    }

    /* ------------------------------ ❤ в уведомлении ------------------------------ */

    fun toggleFavoriteFromNotification() {
        val key = current()?.key ?: return
        val value = !favoriteCurrent
        favoriteCurrent = value
        updateButtons()
        val now = System.currentTimeMillis()
        Database.io.execute {
            try {
                Database.execute(
                    """INSERT INTO track_user (key, favorite_at, duels, gain_offset_db, no_shuffle, updated_at)
                       VALUES (?, ?, 0, 0, 0, ?)
                       ON CONFLICT(key) DO UPDATE SET favorite_at = excluded.favorite_at, updated_at = excluded.updated_at""",
                    listOf(key, if (value) now else null, now),
                )
            } catch (e: Exception) {
                Log.w(TAG, "favorite write failed", e)
            }
            main.post {
                val j = JSONObject().put("action", "favorite").put("key", key).put("value", value)
                listeners.forEach { it.onNotificationAction(j) }
            }
        }
    }

    /** Интерфейс поменял ❤ у трека: обновить кнопку в уведомлении */
    fun setFavoriteState(key: String, value: Boolean) {
        if (current()?.key == key && favoriteCurrent != value) {
            favoriteCurrent = value
            updateButtons()
        }
    }

    private fun refreshFavorite() {
        val key = current()?.key ?: return
        Database.io.execute {
            val fav = try {
                Database.query("SELECT favorite_at FROM track_user WHERE key = ?", listOf(key)).rows.firstOrNull()?.get(0) != null
            } catch (_: Exception) {
                false
            }
            main.post {
                if (current()?.key == key) {
                    favoriteCurrent = fav
                    updateButtons()
                }
            }
        }
        WidgetUpdater.request(app)
    }

    private fun updateButtons() {
        session?.let { PlaybackService.applyButtons(it, favoriteCurrent) }
    }

    /* ------------------------------ снимок очереди ------------------------------ */

    private val queueFile get() = File(app.filesDir, "queue.json")
    private val positionFile get() = File(app.filesDir, "position.json")

    private val saveQueueTask = Runnable {
        val arr = JSONArray()
        queue().forEach { arr.put(it.json) }
        val text = JSONObject().put("items", arr).toString()
        Database.io.execute {
            try {
                queueFile.writeText(text)
            } catch (e: Exception) {
                Log.w(TAG, "queue save failed", e)
            }
        }
        savePosition()
    }

    private val positionTask = object : Runnable {
        override fun run() {
            savePosition()
            if (engine?.active?.isPlaying == true) main.postDelayed(this, 15_000)
        }
    }

    private fun saveQueueSoon() {
        main.removeCallbacks(saveQueueTask)
        main.postDelayed(saveQueueTask, 400)
    }

    private fun savePosition() {
        val p = engine?.active ?: return
        val text = JSONObject()
            .put("index", p.currentMediaItemIndex)
            .put("positionMs", p.currentPosition)
            .put("repeat", repeatName(p.repeatMode))
            .toString()
        Database.io.execute {
            try {
                positionFile.writeText(text)
            } catch (_: Exception) {
            }
        }
        WidgetUpdater.request(app)
    }

    class Saved(val items: List<QItem>, val index: Int, val positionMs: Long, val repeat: String)

    fun loadSaved(): Saved? = try {
        if (!queueFile.exists()) {
            null
        } else {
            val items = parseItems(JSONObject(queueFile.readText()).optJSONArray("items"))
            val pos = if (positionFile.exists()) JSONObject(positionFile.readText()) else JSONObject()
            if (items.isEmpty()) {
                null
            } else {
                Saved(
                    items,
                    pos.optInt("index", 0).coerceIn(0, items.size - 1),
                    pos.optLong("positionMs", 0),
                    pos.optString("repeat", "off"),
                )
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "restore failed", e)
        null
    }

    private fun restore(e: Engine) {
        val s = loadSaved() ?: return
        inEdit = true
        try {
            e.forEachDeck { d ->
                d.setMediaItems(s.items.map { it.toMediaItem() }, s.index, s.positionMs)
                d.repeatMode = when (s.repeat) {
                    "all" -> Player.REPEAT_MODE_ALL
                    "one" -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
            }
        } finally {
            inEdit = false
        }
        rev++
    }
}
