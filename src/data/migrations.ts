/**
 * Схема базы. Это единственное место, где она описана.
 * Нативная часть пишет в три таблицы (tracks, play_events, analysis) и знает их колонки:
 * при изменении этих таблиц поправь Kotlin-код в library/Scanner.kt и tracking/PlayTracker.kt.
 *
 * Версия схемы хранится в PRAGMA user_version. Миграции только добавляются, старые не правятся.
 */
import { syncSchema, syncTriggers } from '../sync/kinds'

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
  {
    version: 3,
    statements: [
      // Старый отпечаток → новый. У MP4 отпечаток теперь по аудиоданным (mdat), а не по началу файла:
      // иначе правка тегов меняла бы его и отрывала историю. Все ссылки переводит KeyAliases.fixup
      // (Kotlin) и rekeyFixupSql (src/data/rekey.ts). Новая таблица с ключом трека — добавь её туда.
      `CREATE TABLE key_aliases (
        old TEXT PRIMARY KEY,
        new TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    // Синхронизация с сервером: журнал изменений и триггеры на таблицах с твоими данными (src/sync/kinds.ts).
    // Триггеры пишут в журнал, только когда синхронизация включена, и срабатывают и на записи из Kotlin
    statements: syncSchema(),
  },
  {
    version: 5,
    statements: [
      // Группы плейлистов (папки в боковом меню). Ссылка на группу — её created_at: он одинаков на всех
      // устройствах, а номер строки у каждого свой
      `CREATE TABLE playlist_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        pos REAL,
        created_at INTEGER NOT NULL UNIQUE,
        updated_at INTEGER NOT NULL
      )`,
      // Свой порядок плейлистов, группа и закрепление. Порядок — дробный: перенос меняет одну строку
      `ALTER TABLE playlists ADD COLUMN pos REAL`,
      `ALTER TABLE playlists ADD COLUMN group_at INTEGER`,
      `ALTER TABLE playlists ADD COLUMN pin_pos REAL`,
      // До этой версии список шёл от недавно изменённых: тот же порядок становится начальным
      `UPDATE playlists SET pos = (SELECT COUNT(*) FROM playlists q
         WHERE q.updated_at > playlists.updated_at OR (q.updated_at = playlists.updated_at AND q.id > playlists.id))`,
      // Синхронизация групп и обложек плейлистов
      ...syncTriggers(5),
    ],
  },
  {
    version: 6,
    statements: [
      // История из Spotify (src/data/repos/spotify.ts). Живёт отдельно от play_events: её можно выключить
      // одним переключателем и удалить целиком, а синхронизация и бэкап её не трогают.
      // Трек Spotify → файл медиатеки (track_key) сопоставляется заново после каждого сканирования,
      // поэтому в KEY_COLUMNS (rekey.ts) этой таблицы нет. duration_ms — оценка по истории
      `CREATE TABLE spotify_tracks (
        uri TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        track_key TEXT
      )`,
      `CREATE TABLE spotify_plays (
        id INTEGER PRIMARY KEY,
        uri TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        tz_offset INTEGER NOT NULL,
        local_day TEXT NOT NULL,
        local_hour INTEGER NOT NULL,
        weekday INTEGER NOT NULL,
        listened_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT NOT NULL,
        counted INTEGER NOT NULL DEFAULT 0,
        UNIQUE (uri, started_at)
      )`,
      `CREATE INDEX ix_spotify_plays_started ON spotify_plays(started_at)`,
      `CREATE INDEX ix_spotify_plays_day ON spotify_plays(local_day)`,
      // Всё, что показывает статистика: свои прослушивания + Spotify, если он включён в настройках.
      // Трек, которого нет в медиатеке, остаётся со своим 'spotify:…': он идёт в общее время и счётчики,
      // а в списках треков не показывается
      `CREATE VIEW stat_plays AS
        SELECT track_key, started_at, ended_at, tz_offset, local_day, local_hour, weekday,
          listened_ms, duration_ms, end_reason, counted, source_type, output
        FROM play_events
        UNION ALL
        SELECT COALESCE(t.track_key, p.uri), p.started_at, p.ended_at, p.tz_offset, p.local_day,
          p.local_hour, p.weekday, p.listened_ms, p.duration_ms, p.end_reason, p.counted, 'spotify', 'Spotify'
        FROM spotify_plays p LEFT JOIN spotify_tracks t ON t.uri = p.uri
        WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'spotify:on' AND value = '1')`,
    ],
  },
  {
    version: 7,
    statements: [
      // Папка с музыкой по Wi-Fi (src/filesync): какими были файлы на обеих сторонах после прошлой синхронизации.
      // Без этого нельзя отличить «удалили на компьютере» от «появилось на телефоне». Только на этом устройстве:
      // в синхронизацию с сервером и в бэкап не идёт
      `CREATE TABLE filesync_base (
        key TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        ls INTEGER NOT NULL,
        lm INTEGER NOT NULL,
        rs INTEGER NOT NULL,
        rm INTEGER NOT NULL
      )`,
      // Подключение к компьютеру (адрес, токен), выбранная папка, итог последнего прохода
      `CREATE TABLE filesync_state (k TEXT PRIMARY KEY, v TEXT)`,
    ],
  },
  {
    version: 8,
    statements: [
      // Свои пресеты звука (src/data/repos/sound-presets.ts). Раньше жили в общих настройках одним куском:
      // при синхронизации набор с одного устройства целиком затирал набор с другого. Теперь каждый пресет —
      // своя запись (kind 'spreset'), наборы телефона и компьютера складываются. data — скорость, тон, эффекты
      `CREATE TABLE sound_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        pos REAL,
        updated_at INTEGER NOT NULL
      )`,
      ...syncTriggers(8),
    ],
  },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
