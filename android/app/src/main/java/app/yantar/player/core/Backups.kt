package app.yantar.player.core

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import app.yantar.player.db.Database
import java.io.File

/**
 * Автобэкап в папку, которую пользователь выбрал один раз (доступ запомнен системой).
 * JSON с данными пишет интерфейс, а движок кладёт рядом копию самой базы.
 * В папке остаются последние N файлов каждого вида.
 */
object Backups {
    fun write(ctx: Context, tree: Uri, name: String, mime: String, data: ByteArray): Uri {
        val cr = ctx.contentResolver
        val dir = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val doc = DocumentsContract.createDocument(cr, dir, mime, name) ?: error("Не удалось создать файл в папке бэкапов")
        cr.openOutputStream(doc, "wt")?.use { it.write(data) } ?: error("Не удалось записать бэкап")
        return doc
    }

    /** Удаляет старые файлы с данным префиксом, оставляя keep самых новых (имена содержат дату) */
    fun prune(ctx: Context, tree: Uri, prefix: String, keep: Int) {
        val cr = ctx.contentResolver
        val rootId = DocumentsContract.getTreeDocumentId(tree)
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId)
        val found = ArrayList<Pair<String, String>>()
        cr.query(
            children,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { c ->
            while (c.moveToNext()) {
                val name = c.getString(1) ?: continue
                if (name.startsWith(prefix)) found.add(c.getString(0) to name)
            }
        }
        found.sortByDescending { it.second }
        for ((id, _) in found.drop(keep)) {
            try {
                DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, id))
            } catch (_: Exception) {
            }
        }
    }

    /** Целостная копия базы (VACUUM INTO) во временный файл */
    fun snapshotDb(ctx: Context): File {
        val f = File(ctx.cacheDir, "yantar-snapshot.db")
        if (f.exists()) f.delete()
        Database.execute("VACUUM INTO ?", listOf(f.absolutePath))
        return f
    }
}
