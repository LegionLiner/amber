package app.yantar.player.db

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram
import android.util.Base64
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Единственный владелец базы yantar.db.
 * Схему создаёт TypeScript (src/data/migrations.ts) через query/execute/batch.
 * Нативная часть сама пишет только в tracks (сканер), play_events (учёт прослушиваний)
 * и track_user (кнопка ❤ в уведомлении).
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
            val file = context.applicationContext.getDatabasePath("yantar.db")
            file.parentFile?.mkdirs()
            val db = SQLiteDatabase.openDatabase(
                file.path,
                null,
                SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
            )
            db.execSQL("PRAGMA synchronous = NORMAL")
            instance = db
            return db
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
