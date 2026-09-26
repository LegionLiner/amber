package app.yantar.player.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Фоновая служба. Даёт музыке жить при выключенном экране и связывает плеер с системой:
 * шторка, экран блокировки, Now Bar, часы, кнопки наушников — всё через MediaSession.
 * Уведомление Media3 строит сама; мы добавляем только кнопку ❤.
 */
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        PlayerHub.init(this)
        val player = PlayerHub.player()
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
        val activity = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val session = MediaSession.Builder(this, player)
            .setSessionActivity(activity)
            .setCallback(Callback())
            .build()
        mediaSession = session
        // Без явного addSession Media3 не покажет уведомление: к сессии не подключён ни один контроллер
        addSession(session)
        PlayerHub.session = session
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Смахнули приложение из недавних: если музыка на паузе, службе незачем жить
        val p = mediaSession?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        PlayerHub.session = null
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }

    private inner class Callback : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(FAVORITE)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
                .setAvailableSessionCommands(commands)
                .setMediaButtonPreferences(listOf(heartButton(false)))
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction == ACTION_FAVORITE) {
                PlayerHub.toggleFavoriteFromNotification()
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            return super.onCustomCommand(session, controller, customCommand, args)
        }

        /** Карточка «продолжить» после перезагрузки и кнопка play на наушниках, когда приложение не запущено */
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = resumption()

        private fun resumption(): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val s = PlayerHub.loadSaved()
                ?: return Futures.immediateFailedFuture(UnsupportedOperationException("Нечего продолжать"))
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(s.items.map { it.toMediaItem() }, s.index, s.positionMs),
            )
        }
    }

    companion object {
        const val ACTION_FAVORITE = "app.yantar.player.FAVORITE"
        val FAVORITE = SessionCommand(ACTION_FAVORITE, Bundle.EMPTY)

        fun heartButton(favorite: Boolean): CommandButton =
            CommandButton.Builder(if (favorite) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
                .setDisplayName(if (favorite) "Убрать из избранного" else "В избранное")
                .setSessionCommand(FAVORITE)
                .setSlots(CommandButton.SLOT_OVERFLOW)
                .build()

        fun applyButtons(session: MediaSession, favorite: Boolean) {
            session.setMediaButtonPreferences(listOf(heartButton(favorite)))
        }
    }
}
