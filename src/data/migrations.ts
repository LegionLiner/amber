/**
 * Схема базы. Это единственное место, где она описана.
 * Нативная часть пишет в три таблицы (tracks, play_events, analysis) и знает их колонки:
 * при изменении этих таблиц поправь Kotlin-код в library/Scanner.kt и tracking/PlayTracker.kt.
 *
 * Версия схемы хранится в PRAGMA user_version. Миграции только добавляются, старые не правятся.
 */
export interface Migration {
  version: number
  statements: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      // Файлы на телефоне. Таблицу перезаписывает сканер, пользовательских данных здесь нет.
      `CREATE TABLE tracks (
        key TEXT PRIMARY KEY,
        media_id INTEGER,
        uri TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        folder TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        artist TEXT,
        album TEXT,
        album_artist TEXT,
        genre TEXT,
        year INTEGER,
        track_no INTEGER,
        disc_no INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        bitrate INTEGER,
        sample_rate INTEGER,
        mime TEXT,
        art TEXT,
        color1 TEXT,
        color2 TEXT,
        has_lyrics INTEGER NOT NULL DEFAULT 0,
        rg_track_db REAL,
        rg_album_db REAL,
        popm INTEGER,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        missing_since INTEGER
      )`,
      `CREATE INDEX ix_tracks_media ON tracks(media_id)`,
      `CREATE INDEX ix_tracks_folder ON tracks(folder)`,

      // Всё, что сделал ты. Привязано к отпечатку, поэтому переживает пересканирование.
      `CREATE TABLE track_user (
        key TEXT PRIMARY KEY,
        rating INTEGER,
        rated_at INTEGER,
        rank_score REAL,
        duels INTEGER NOT NULL DEFAULT 0,
        favorite_at INTEGER,
        note TEXT,
        overrides TEXT,
        trim_start_ms INTEGER,
        trim_end_ms INTEGER,
        gain_offset_db REAL NOT NULL DEFAULT 0,
        no_shuffle INTEGER NOT NULL DEFAULT 0,
        custom_art TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE rating_history (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL,
        rating INTEGER,
        at INTEGER NOT NULL
      )`,
      `CREATE INDEX ix_rating_history_key ON rating_history(key, at)`,

      // Каждое прослушивание. Пишет нативный PlayTracker.
      `CREATE TABLE play_events (
        id INTEGER PRIMARY KEY,
        track_key TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        tz_offset INTEGER NOT NULL,
        local_day TEXT NOT NULL,
        local_hour INTEGER NOT NULL,
        weekday INTEGER NOT NULL,
        listened_ms INTEGER NOT NULL DEFAULT 0,
        pos_start_ms INTEGER,
        pos_end_ms INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT,
        counted INTEGER NOT NULL DEFAULT 0,
        source_type TEXT,
        source_id TEXT,
        output TEXT,
        session_id INTEGER
      )`,
      `CREATE INDEX ix_plays_track ON play_events(track_key, started_at)`,
      `CREATE INDEX ix_plays_started ON play_events(started_at)`,
      `CREATE INDEX ix_plays_day ON play_events(local_day)`,

      `CREATE TABLE playlists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'manual',
        rules TEXT,
        sort TEXT,
        cover TEXT,
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE playlist_items (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL,
        pos REAL NOT NULL,
        track_key TEXT NOT NULL,
        transition TEXT,
        added_at INTEGER NOT NULL
      )`,
      `CREATE INDEX ix_playlist_items ON playlist_items(playlist_id, pos)`,

      `CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY,
        track_key TEXT NOT NULL,
        position_ms INTEGER NOT NULL,
        end_ms INTEGER,
        title TEXT NOT NULL DEFAULT '',
        color TEXT,
        kind TEXT NOT NULL DEFAULT 'mark',
        note TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX ix_bookmarks_track ON bookmarks(track_key, position_ms)`,

      `CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE track_tags (
        track_key TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (track_key, tag_id)
      )`,

      `CREATE TABLE eras (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'custom',
        start_day TEXT NOT NULL,
        end_day TEXT NOT NULL,
        color TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE contexts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        rules TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE context_intervals (
        id INTEGER PRIMARY KEY,
        context_id INTEGER NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER
      )`,
      `CREATE TABLE diary (
        day TEXT PRIMARY KEY,
        mood INTEGER,
        note TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE duels (
        id INTEGER PRIMARY KEY,
        a_key TEXT NOT NULL,
        b_key TEXT NOT NULL,
        result REAL NOT NULL,
        at INTEGER NOT NULL
      )`,
      `CREATE TABLE rank_snapshots (
        week TEXT NOT NULL,
        track_key TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (week, track_key)
      )`,
      `CREATE TABLE weekly_charts (
        week TEXT NOT NULL,
        position INTEGER NOT NULL,
        track_key TEXT NOT NULL,
        plays INTEGER NOT NULL,
        listened_ms INTEGER NOT NULL,
        PRIMARY KEY (week, position)
      )`,
      `CREATE TABLE analysis (
        key TEXT PRIMARY KEY,
        lufs REAL,
        true_peak_db REAL,
        intro_silence_ms INTEGER,
        outro_silence_ms INTEGER,
        waveform TEXT,
        energy REAL,
        bpm REAL,
        analyzed_at INTEGER NOT NULL
      )`,
      `CREATE TABLE track_neighbors (
        key TEXT NOT NULL,
        other TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (key, other)
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE device_profiles (
        device TEXT PRIMARY KEY,
        eq TEXT,
        gain_db REAL,
        crossfade TEXT,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      // Текст песни, который ты вставил сам (из файла текст читается на лету)
      `CREATE TABLE lyrics (
        key TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      // Для «Уборки»: подсказки, которые ты отклонил, больше не показываются
      `CREATE TABLE dismissed (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (kind, key)
      )`,
      `CREATE INDEX ix_plays_counted_day ON play_events(counted, local_day)`,
    ],
  },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
