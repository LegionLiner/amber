package app.yantar.player.db

import android.content.Context
import android.database.Cursor
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram
import android.util.Base64
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Единственный владелец базы yantar.db.
 * Схему создаёт TypeScript (src/data/migrations.ts) через query/execute/batch.
 * Нативная часть сама пишет только в tracks (сканер), play_events (учёт прослушиваний)
 * и track_user (кнопка ❤ в уведомлении).
 *
 * WAL + synchronous=NORMAL не портят базу при внезапном выключении (теряются максимум последние записи).
 * На случай, если файл всё-таки испортится (сбой памяти, карты, системы), — ежедневная копия
 * и восстановление из неё при запуске вместо стандартного удаления базы (см. openChecked).
 */
object Database {
    @Volatile
    private var instance: SQLiteDatabase? = null

    /** Отдельный поток для записей из движка, чтобы не трогать диск в главном потоке */
    val io: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "yantar-db").apply { isDaemon = true } }

    fun init(context: Context): SQLiteDatabase {
        instance?.let { return it }
        synchronized(this) {
            instance?.let { return it }
            val app = context.applicationContext
            val file = app.getDatabasePath(DB_NAME)
            file.parentFile?.mkdirs()
            val db = openChecked(app, file)
            instance = db
            io.execute { snapshotIfDue(app) }
            return db
        }
    }

    /* ---------------- защита от повреждения ---------------- */

    private const val TAG = "yantar-db"
    private const val DB_NAME = "yantar.db"
    /** Ежедневные копии базы — в files/db-backup, хранятся две последние */
    private const val SNAPSHOT_DIR = "db-backup"
    private const val KEEP_SNAPSHOTS = 2
    /** Метка «SQLite заметил повреждение»: при следующем запуске база проверяется целиком */
    private const val CORRUPT_MARKER = "db-corrupt"
    /** Что восстановили при запуске: интерфейс показывает это один раз (MusicCorePlugin.getInfo) */
    private const val RECOVERY_NOTE = "db-recovered"
    private val SQLITE_MAGIC = "SQLite format 3\u0000".toByteArray(Charsets.ISO_8859_1)

    private fun open(file: File, app: Context): SQLiteDatabase {
        // Обработчик по умолчанию при повреждении УДАЛЯЕТ файл базы вместе со всей историей.
        // Наш ничего не удаляет: только ставит метку, а разбирается openChecked при следующем запуске
        val keep = DatabaseErrorHandler {
            Log.e(TAG, "SQLite сообщил о повреждении базы")
            try {
                File(app.filesDir, CORRUPT_MARKER).createNewFile()
            } catch (_: Exception) {
            }
        }
        val db = SQLiteDatabase.openDatabase(
            file.path,
            null,
            SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
            keep,
        )
        db.execSQL("PRAGMA synchronous = NORMAL")
        return db
    }

    /**
     * Открывает базу и проверяет, что она читается. Обычно проверка — одно чтение первой страницы;
     * если в прошлый раз SQLite заметил повреждение — полная (quick_check).
     * Не читается — файл откладывается в сторону (yantar.db.broken-…, не удаляется),
     * на его место встаёт последняя ежедневная копия, а если копий нет — пустая база.
     */
    private fun openChecked(app: Context, file: File): SQLiteDatabase {
        val marker = File(app.filesDir, CORRUPT_MARKER)
        try {
            val db = open(file, app)
            if (healthy(db, deep = marker.exists())) {
                marker.delete()
                return db
            }
            db.close()
        } catch (e: Exception) {
            Log.e(TAG, "база не открывается", e)
        }
        val broken = moveAside(file)
        val snapshot = latestSnapshot(app)
        var restoredFrom: Long? = null
        if (snapshot != null) {
            try {
                copyDurable(snapshot, file)
                restoredFrom = snapshot.lastModified()
            } catch (e: Exception) {
                Log.e(TAG, "не удалось восстановить копию ${snapshot.name}", e)
                file.delete()
            }
        }
        marker.delete()
        Log.w(TAG, "база повреждена, отложена как ${broken?.name}; восстановлено: ${snapshot?.name ?: "ничего"}")
        try {
            File(app.filesDir, RECOVERY_NOTE).writeText("${restoredFrom ?: ""}|${broken?.name ?: ""}")
        } catch (_: Exception) {
        }
        return open(file, app)
    }

    private fun healthy(db: SQLiteDatabase, deep: Boolean): Boolean = try {
        if (deep) {
            db.rawQuery("PRAGMA quick_check", null).use { c -> c.moveToFirst() && c.getString(0) == "ok" }
        } else {
            db.rawQuery("SELECT COUNT(*) FROM sqlite_master", null).use { c -> c.moveToFirst() }
        }
    } catch (e: Exception) {
        Log.e(TAG, "проверка базы не прошла", e)
        false
    }

    /** Битая база вместе с журналом WAL — в сторону: если оставить чужой WAL, он испортит новую базу */
    private fun moveAside(file: File): File? {
        if (!file.exists()) return null
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val target = File(file.parentFile, "${file.name}.broken-$stamp")
        if (!file.renameTo(target)) file.delete()
        for (suffix in listOf("-wal", "-shm", "-journal")) {
            val f = File(file.path + suffix)
            if (f.exists() && !f.renameTo(File(target.path + suffix))) f.delete()
        }
        return target.takeIf { it.exists() }
    }

    private fun looksLikeSqlite(f: File): Boolean = try {
        f.length() >= 512 && f.inputStream().use { s ->
            val head = ByteArray(SQLITE_MAGIC.size)
            s.read(head) == head.size && head.contentEquals(SQLITE_MAGIC)
        }
    } catch (_: Exception) {
        false
    }

    private fun snapshots(app: Context): List<File> =
        File(app.filesDir, SNAPSHOT_DIR).listFiles { f -> f.name.startsWith("yantar-") && f.name.endsWith(".db") }
            ?.sortedByDescending { it.name }
            .orEmpty()

    private fun latestSnapshot(app: Context): File? = snapshots(app).firstOrNull { looksLikeSqlite(it) }

    /** Копия, которая переживёт выключение: во временный файл, fsync, потом подмена */
    private fun copyDurable(src: File, dst: File) {
        val tmp = File(dst.path + ".tmp")
        FileInputStream(src).use { input ->
            FileOutputStream(tmp).use { out ->
                input.copyTo(out)
                out.fd.sync()
            }
        }
        if (!tmp.renameTo(dst)) {
            tmp.delete()
            error("не удалось переименовать ${tmp.name}")
        }
    }

    /**
     * Раз в день — копия базы через VACUUM INTO: целостный снимок, даже пока играет музыка.
     * Из битой базы снимок не сделается (VACUUM читает все страницы), поэтому копии всегда здоровые.
     */
    private fun snapshotIfDue(app: Context) {
        val dir = File(app.filesDir, SNAPSHOT_DIR)
        try {
            dir.mkdirs()
            val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val target = File(dir, "yantar-$day.db")
            if (target.exists()) return
            val tmp = File(dir, "yantar-$day.db.tmp")
            tmp.delete()
            db.execSQL("VACUUM INTO '${tmp.path.replace("'", "''")}'")
            RandomAccessFile(tmp, "rw").use { it.fd.sync() }
            if (!tmp.renameTo(target)) {
                tmp.delete()
                return
            }
            snapshots(app).drop(KEEP_SNAPSHOTS).forEach { it.delete() }
        } catch (e: Exception) {
            Log.w(TAG, "ежедневная копия базы не сделана", e)
            dir.listFiles { f -> f.name.endsWith(".tmp") }?.forEach { it.delete() }
        }
    }

    /**
     * Восстанавливали ли базу при запуске: время копии (null — копии не было, база начата заново)
     * и имя отложенного файла. Отдаётся один раз, чтобы интерфейс показал это и забыл.
     */
    fun takeRecovery(context: Context): Pair<Long?, String?>? {
        val note = File(context.applicationContext.filesDir, RECOVERY_NOTE)
        if (!note.exists()) return null
        return try {
            val (at, name) = note.readText().split('|', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            at.toLongOrNull() to name.ifEmpty { null }
        } catch (_: Exception) {
            null
        } finally {
            note.delete()
        }
    }

    val db: SQLiteDatabase
        get() = instance ?: error("Database.init() не вызван")

    class Result(val columns: Array<String>, val rows: List<Array<Any?>>)

    /** SELECT с типизированными параметрами (rawQuery умеет только строки, поэтому своя фабрика курсора) */
    fun query(sql: String, args: List<Any?>): Result {
        val factory = SQLiteDatabase.CursorFactory { _, driver, editTable, query ->
            bindAll(query, args)
            SQLiteCursor(driver, editTable, query)
        }
        db.rawQueryWithFactory(factory, sql, null, "").use { c ->
            val columns = c.columnNames
            val rows = ArrayList<Array<Any?>>(c.count.coerceAtLeast(0))
            while (c.moveToNext()) {
                val row = arrayOfNulls<Any?>(columns.size)
                for (i in columns.indices) row[i] = readValue(c, i)
                rows.add(row)
            }
            return Result(columns, rows)
        }
    }

    class Exec(val changes: Int, val lastId: Long)

    fun execute(sql: String, args: List<Any?>): Exec {
        val verb = sql.trimStart().take(8).uppercase()
        db.compileStatement(sql).use { st ->
            bindAll(st, args)
            return when {
                verb.startsWith("INSERT") || verb.startsWith("REPLACE") -> {
                    val id = st.executeInsert()
                    Exec(if (id >= 0) 1 else 0, id)
                }
                verb.startsWith("UPDATE") || verb.startsWith("DELETE") -> Exec(st.executeUpdateDelete(), 0)
                else -> {
                    st.execute()
                    Exec(0, 0)
                }
            }
        }
    }

    /** Несколько запросов одной транзакцией: либо все, либо ни одного */
    fun batch(statements: List<Pair<String, List<Any?>>>): List<Exec> {
        val out = ArrayList<Exec>(statements.size)
        db.beginTransactionNonExclusive()
        try {
            for ((sql, args) in statements) out.add(execute(sql, args))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return out
    }

    private fun bindAll(p: SQLiteProgram, args: List<Any?>) {
        args.forEachIndexed { i, v ->
            val idx = i + 1
            when (v) {
                null -> p.bindNull(idx)
                is Int -> p.bindLong(idx, v.toLong())
                is Long -> p.bindLong(idx, v)
                is Boolean -> p.bindLong(idx, if (v) 1 else 0)
                is Double -> if (v % 1.0 == 0.0 && kotlin.math.abs(v) < 9.0E15) p.bindLong(idx, v.toLong()) else p.bindDouble(idx, v)
                is Float -> p.bindDouble(idx, v.toDouble())
                is Number -> p.bindDouble(idx, v.toDouble())
                is ByteArray -> p.bindBlob(idx, v)
                else -> p.bindString(idx, v.toString())
            }
        }
    }

    private fun readValue(c: Cursor, i: Int): Any? = when (c.getType(i)) {
        Cursor.FIELD_TYPE_NULL -> null
        Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
        Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
        Cursor.FIELD_TYPE_BLOB -> Base64.encodeToString(c.getBlob(i), Base64.NO_WRAP)
        else -> c.getString(i)
    }

    /** Есть ли таблица (TS мог ещё не прогнать миграции при самом первом запуске) */
    fun hasTable(name: String): Boolean = try {
        query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", listOf(name)).rows.isNotEmpty()
    } catch (_: Exception) {
        false
    }
}
