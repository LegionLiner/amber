package app.yantar.player.playback

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONObject

/**
 * Элемент очереди. Хранит исходный JSON из TypeScript, чтобы вернуть его без изменений
 * в getState(): интерфейс получает ровно те объекты, которые отправлял.
 * Поля совпадают с QueueItem в src/native/types.ts.
 */
class QItem(val json: JSONObject) {
    val qid: String = json.optString("qid")
    /** Может смениться, если файл получил новый отпечаток (см. KeyAliases) */
    var key: String = json.optString("key")
        private set

    fun rekey(newKey: String) {
        key = newKey
        json.put("key", newKey)
    }
    val uri: String = json.optString("uri")
    val title: String = json.optString("title")
    val artist: String = json.optString("artist")
    val album: String? = json.optString("album").ifEmpty { null }
    val artUri: String? = json.optString("artUri").ifEmpty { null }
    val durationMs: Long = json.optLong("durationMs")
    val gainDb: Double = json.optDouble("gainDb", 0.0)
    val trimStartMs: Long? = if (json.has("trimStartMs") && !json.isNull("trimStartMs")) json.optLong("trimStartMs") else null
    val trimEndMs: Long? = if (json.has("trimEndMs") && !json.isNull("trimEndMs")) json.optLong("trimEndMs") else null
    val sourceType: String? = json.optJSONObject("source")?.optString("type")?.ifEmpty { null }
    val sourceId: String? = json.optJSONObject("source")?.optString("id")?.ifEmpty { null }
    val trackNo: Int? = if (json.has("trackNo") && !json.isNull("trackNo")) json.optInt("trackNo") else null
    /** Настройка стыка с предыдущим треком (миксы); null — общие настройки */
    val transitionIn: JSONObject? = json.optJSONObject("transitionIn")

    fun toMediaItem(): MediaItem {
        val meta = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setIsPlayable(true)
            .setIsBrowsable(false)
        artUri?.let { meta.setArtworkUri(Uri.parse(it)) }
        val b = MediaItem.Builder()
            .setMediaId(qid)
            .setUri(uri)
            .setMediaMetadata(meta.build())
            .setTag(this)
        if ((trimStartMs ?: 0) > 0 || trimEndMs != null) {
            b.setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(trimStartMs ?: 0)
                    .setEndPositionMs(trimEndMs ?: C.TIME_END_OF_SOURCE)
                    .build(),
            )
        }
        return b.build()
    }

    companion object {
        /** Элемент, пришедший не от нас (например, из системной карточки «продолжить») */
        fun fromMediaItem(item: MediaItem): QItem {
            (item.localConfiguration?.tag as? QItem)?.let { return it }
            val j = JSONObject()
            j.put("qid", item.mediaId)
            j.put("key", item.mediaId)
            j.put("uri", item.localConfiguration?.uri?.toString() ?: "")
            j.put("title", item.mediaMetadata.title?.toString() ?: "")
            j.put("artist", item.mediaMetadata.artist?.toString() ?: "")
            j.put("durationMs", 0)
            j.put("gainDb", 0)
            j.put("source", JSONObject().put("type", "library"))
            return QItem(j)
        }
    }
}
