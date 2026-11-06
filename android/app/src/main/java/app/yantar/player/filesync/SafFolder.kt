package app.yantar.player.filesync

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import app.yantar.player.core.Lang
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Папка, выбранная системным окном (Storage Access Framework). Пользователь выбирает её один раз, Android запоминает
 * разрешение (takePersistableUriPermission) — дальше читаем, пишем, переименовываем, переносим и удаляем внутри неё
 * без вопросов и без доступа «ко всем файлам».
 *
 * Папки только из памяти телефона и с карты (com.android.externalstorage.documents): там id документа — это
 * «том:путь» («primary:Music/Rock/a.mp3»), поэтому файл по относительному пути находится сразу, без обхода папок.
 */
class SafFolder(private val ctx: Context, val tree: Uri) {
    private val cr: ContentResolver = ctx.contentResolver
    private val rootId: String = DocumentsContract.getTreeDocumentId(tree)

    init {
        require(tree.authority == AUTHORITY) { Lang.t("Папка должна быть в памяти телефона или на карте", "The folder must be on the phone or an SD card") }
    }

    fun idOf(p: String): String = when {
        p.isEmpty() -> rootId
        rootId.endsWith(":") -> rootId + p
        else -> "$rootId/$p"
    }

    fun uriOf(p: String): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, idOf(p))

    class Entry(val name: String, val dir: Boolean, val size: Long, val mtime: Long)

    private val COLS = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED)

    /** Что лежит по пути: null — ничего (или нет доступа) */
    fun entry(p: String): Entry? =
        runCatching {
            cr.query(uriOf(p), COLS, null, null, null)?.use { c ->
                if (!c.moveToFirst()) null else Entry(c.getString(1) ?: p.substringAfterLast('/'), c.getString(2) == Document.MIME_TYPE_DIR, c.getLong(3), c.getLong(4))
            }
        }.getOrNull()

    fun stat(p: String): FileSync.Stat? = entry(p)?.takeIf { !it.dir }?.let { FileSync.Stat(it.size, it.mtime) }

    fun exists(p: String): Boolean = entry(p) != null

    /** Содержимое папки rel (без обхода вглубь) */
    fun children(rel: String): List<Entry> {
        val u = DocumentsContract.buildChildDocumentsUriUsingTree(tree, idOf(rel))
        val out = ArrayList<Entry>()
        cr.query(u, COLS, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val name = c.getString(1)
                if (name != null) out.add(Entry(name, c.getString(2) == Document.MIME_TYPE_DIR, c.getLong(3), c.getLong(4)))
            }
        } ?: throw IOException(Lang.t("Нет доступа к папке — выбери её заново", "No access to the folder — choose it again"))
        return out
    }

    /** Папка rel со всеми недостающими родителями */
    fun ensureDir(rel: String) {
        if (rel.isEmpty()) return
        var cur = ""
        for (seg in rel.split('/')) {
            val next = if (cur.isEmpty()) seg else "$cur/$seg"
            val e = entry(next)
            if (e == null) {
                val made = DocumentsContract.createDocument(cr, uriOf(cur), Document.MIME_TYPE_DIR, seg)
                if (made == null || DocumentsContract.getDocumentId(made) != idOf(next)) {
                    made?.let { runCatching { DocumentsContract.deleteDocument(cr, it) } }
                    throw IOException(Lang.t("Не удалось создать папку «$seg»", "Couldn't create the folder “$seg”"))
                }
            } else if (!e.dir) {
                throw IOException(Lang.t("«$seg» — файл, а нужна папка", "“$seg” is a file, not a folder"))
            }
            cur = next
        }
    }

    /** Новый файл p. Если такое имя уже занято, Android выдал бы «имя (1)» — тогда это ошибка */
    fun create(p: String): Uri {
        ensureDir(parentOf(p))
        // application/octet-stream: Android не дописывает расширение и не трогает имя
        val u = DocumentsContract.createDocument(cr, uriOf(parentOf(p)), "application/octet-stream", p.substringAfterLast('/'))
            ?: throw IOException(Lang.t("Не удалось создать «${p.substringAfterLast('/')}»", "Couldn't create “${p.substringAfterLast('/')}”"))
        if (DocumentsContract.getDocumentId(u) != idOf(p)) {
            runCatching { DocumentsContract.deleteDocument(cr, u) }
            throw IOException(Lang.t("Не удалось создать «${p.substringAfterLast('/')}»", "Couldn't create “${p.substringAfterLast('/')}”"))
        }
        return u
    }

    fun read(p: String): InputStream = cr.openInputStream(uriOf(p)) ?: throw IOException(Lang.t("Не удалось открыть «$p»", "Couldn't open “$p”"))

    fun write(u: Uri): OutputStream = cr.openOutputStream(u, "w") ?: throw IOException(Lang.t("Не удалось записать файл", "Couldn't write the file"))

    /** Переименовать p в newName в той же папке; true — получилось ровно это имя */
    fun rename(p: String, newName: String): Boolean {
        val target = (parentOf(p).let { if (it.isEmpty()) newName else "$it/$newName" })
        val u = runCatching { DocumentsContract.renameDocument(cr, uriOf(p), newName) }.getOrNull() ?: return false
        return DocumentsContract.getDocumentId(u) == idOf(target)
    }

    /** Перенести p в папку toDir (её создаём заранее). В toDir не должно быть файла с тем же именем */
    fun move(p: String, toDir: String): Boolean {
        val u = runCatching { DocumentsContract.moveDocument(cr, uriOf(p), uriOf(parentOf(p)), uriOf(toDir)) }.getOrNull()
        return u != null
    }

    fun delete(p: String): Boolean = runCatching { DocumentsContract.deleteDocument(cr, uriOf(p)) }.getOrDefault(false)

    /** Обычный путь к файлу — только чтобы медиатека телефона пересканировала его */
    fun pathOf(p: String): String? {
        val id = idOf(p)
        val vol = id.substringBefore(':')
        val rel = id.substringAfter(':', "")
        val base = if (vol == "primary") Environment.getExternalStorageDirectory().absolutePath else "/storage/$vol"
        return if (rel.isEmpty()) base else "$base/$rel"
    }

    companion object {
        const val AUTHORITY = "com.android.externalstorage.documents"

        fun parentOf(p: String): String = if ('/' in p) p.substringBeforeLast('/') else ""

        /** Разрешение на папку есть и Android его помнит */
        fun granted(ctx: Context, tree: Uri): Boolean =
            ctx.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission && it.isWritePermission }

        /** С чего открыть системное окно выбора: «Музыка» в памяти телефона */
        fun musicUri(): Uri = DocumentsContract.buildDocumentUri(AUTHORITY, "primary:${Environment.DIRECTORY_MUSIC}")

        /** «primary:Music/Rock» → «Music/Rock», карта «1234-ABCD:Music» → «1234-ABCD/Music» — подпись для настроек */
        fun label(tree: Uri): String {
            val id = DocumentsContract.getTreeDocumentId(tree)
            val vol = id.substringBefore(':')
            val rel = id.substringAfter(':', "")
            return if (vol == "primary") rel.ifEmpty { "/" } else if (rel.isEmpty()) vol else "$vol/$rel"
        }
    }
}
