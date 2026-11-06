import type { SqlStatement, SqlValue } from '../native/types'
import { APPLY_ORDER, KINDS, type SyncDb, type SyncItem } from './kinds'

/**
 * Синхронизация с сервером Amber. Один проход — несколько запросов /v1/sync до тех пор, пока
 * журнал изменений не опустеет и сервер не отдаст всё новое:
 *
 * 1. Из журнала sync_outbox берутся до 300 записей, читаются их текущие данные (удалённые — отметкой)
 *    и карточки треков, на которые они ссылаются (название и исполнитель — чтобы на другом устройстве
 *    история показывала треки, которых там нет).
 * 2. Сервер принимает их (побеждает более позднее изменение) и отдаёт изменения других устройств
 *    после курсора.
 * 3. Пришедшее применяется одной транзакцией с флагом applying: триггеры молчат, эхо не уходит обратно.
 *    Если своя правка той же записи новее пришедшей — пришедшая пропускается, своя уйдёт следующей.
 *
 * Модуль без зависимостей от приложения: его же гоняют тесты сервера на двух «устройствах».
 */

export interface SyncResponse {
  cursor: number
  changes: SyncItem[]
  more: boolean
}

export interface SyncTransport {
  sync(body: { cursor: number; changes: SyncItem[] }): Promise<SyncResponse>
}

export interface SyncHooks {
  /** Настройки, которые синхронизируются (часть AppSettings) */
  readPrefs?(): Record<string, unknown> | null
  applyPrefs?(data: Record<string, unknown>): void
  /** Картинка обложки по её ключу на устройстве — base64 JPEG небольшого размера (null — файла нет) */
  readCover?(art: string): Promise<string | null>
  /** Сохранить пришедшую картинку как обложку на устройстве: ключ для таблицы */
  saveCover?(image: string): Promise<string>
}

export interface SyncReport {
  pushed: number
  pulled: number
  /** Какие виды данных пришли — что перечитать в интерфейсе */
  kinds: Set<string>
}

const BATCH = 300
const MAX_ROUNDS = 400

async function state(db: SyncDb, k: string): Promise<string | null> {
  return (await db.all<{ v: string }>(`SELECT v FROM sync_state WHERE k = ?`, [k]))[0]?.v ?? null
}
const setState = (k: string, v: string | null): SqlStatement =>
  v == null
    ? { sql: `DELETE FROM sync_state WHERE k = ?`, params: [k] }
    : { sql: `INSERT OR REPLACE INTO sync_state (k, v) VALUES (?, ?)`, params: [k, v] }

export async function isEnabled(db: SyncDb): Promise<boolean> {
  return (await state(db, 'enabled')) != null
}

/**
 * Включить синхронизацию: всё, что уже есть на устройстве, попадает в журнал со своим временем изменения
 * (а не «сейчас»): так при первой встрече двух устройств побеждает действительно более поздняя оценка.
 */
export async function enableSync(db: SyncDb): Promise<void> {
  await db.batch([
    setState('enabled', '1'),
    setState('cursor', '0'),
    { sql: `DELETE FROM sync_outbox` },
    { sql: `DELETE FROM sync_cards` },
    ...KINDS.map((k) => ({
      sql: `INSERT OR REPLACE INTO sync_outbox (kind, eid, at) SELECT '${k.kind}', eid, at FROM (${k.seed}) WHERE eid IS NOT NULL`,
    })),
    { sql: `INSERT OR REPLACE INTO sync_outbox (kind, eid, at) VALUES ('pref', 'app', 0)` },
  ])
}

/** Выйти: журнал и курсор забываются, данные на устройстве остаются */
export async function disableSync(db: SyncDb): Promise<void> {
  await db.batch([{ sql: `DELETE FROM sync_state` }, { sql: `DELETE FROM sync_outbox` }, { sql: `DELETE FROM sync_cards` }])
}

/** Сколько ждёт отправки. Трек, который играет прямо сейчас, не в счёт: он уйдёт, когда доиграет */
export async function pendingCount(db: SyncDb): Promise<number> {
  const rows = await db.all<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM sync_outbox) - (
       SELECT COUNT(*) FROM sync_outbox WHERE kind = 'play'
         AND eid IN (SELECT track_key || '@' || started_at FROM play_events WHERE end_reason IS NULL)
     ) AS n`,
  )
  return Number(rows[0]?.n ?? 0)
}

/** Стабильная строка для сравнения настроек: порядок полей не важен */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

const byKind = new Map(KINDS.map((k) => [k.kind, k]))

/** Отправка и приём до опустевшего журнала */
export async function runSync(db: SyncDb, transport: SyncTransport, hooks: SyncHooks = {}): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, kinds: new Set() }
  if (!(await isEnabled(db))) return report
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const cursor = Number((await state(db, 'cursor')) ?? 0)
    const outbox = await db.all<{ kind: string; eid: string; at: number }>(
      `SELECT kind, eid, at FROM sync_outbox ORDER BY at LIMIT ${BATCH}`,
    )
    const changes: SyncItem[] = []
    const sent: { kind: string; eid: string; at: number }[] = []
    const keys = new Set<string>()
    let prefHash: string | null = null
    for (const o of outbox) {
      if (o.kind === 'pref') {
        const data = hooks.readPrefs?.() ?? null
        const hash = data ? stable(data) : null
        // Настройки сохраняются целиком на любое изменение: отправляем, только если общие поменялись
        if (data && hash !== (await state(db, 'prefHash'))) {
          // При первом включении время 0: настройки, уже сохранённые с другого устройства, не затираются
          changes.push({ kind: 'pref', id: 'app', data, deleted: false, updatedAt: o.at })
          prefHash = hash
        }
        sent.push(o)
        continue
      }
      const def = byKind.get(o.kind)
      if (!def) {
        sent.push(o)
        continue
      }
      let data = await def.read(db, o.eid)
      if (data === 'wait') continue
      if (def.media && data) {
        // Вместо ключа файла — сама картинка. Не прочиталась (файла нет, нечем читать) — не отправляем
        const image = typeof data.art === 'string' && hooks.readCover ? await hooks.readCover(data.art).catch(() => null) : null
        if (!image) {
          sent.push(o)
          continue
        }
        data = { image }
      }
      changes.push({ kind: o.kind, id: o.eid, data, deleted: data == null, updatedAt: o.at })
      sent.push(o)
      if (data && def.trackKeys) for (const k of def.trackKeys(data)) keys.add(k)
    }
    changes.push(...(await cards(db, keys)))

    const res = await transport.sync({ cursor, changes })
    report.pushed += changes.length

    const done: SqlStatement[] = [
      // Запись в журнале удаляется, только если с тех пор её не меняли ещё раз
      ...sent.map((o) => ({
        sql: `DELETE FROM sync_outbox WHERE kind = ? AND eid = ? AND at = ?`,
        params: [o.kind, o.eid, o.at] as SqlValue[],
      })),
      ...changes
        .filter((c) => c.kind === 'card')
        .map((c) => ({ sql: `INSERT OR IGNORE INTO sync_cards (key) VALUES (?)`, params: [c.id] as SqlValue[] })),
    ]
    if (prefHash) done.push(setState('prefHash', prefHash))
    await db.batch(done)

    await applyIncoming(db, res.changes, hooks, report)
    await db.batch([setState('cursor', String(res.cursor))])

    const left = await pendingCount(db)
    const stuck = sent.length === 0 && left > 0
    if (!res.more && (left === 0 || stuck)) break
  }
  return report
}

/** Карточки треков, которые ещё не отправлялись: по ним другое устройство покажет название в истории */
async function cards(db: SyncDb, keys: Set<string>): Promise<SyncItem[]> {
  if (!keys.size) return []
  const list = [...keys]
  const out: SyncItem[] = []
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400)
    const marks = part.map(() => '?').join(',')
    const rows = await db.all<Record<string, SqlValue>>(
      `SELECT key, title, artist, album, album_artist, genre, year, duration_ms, file_name, updated_at FROM tracks
       WHERE key IN (${marks}) AND key NOT IN (SELECT key FROM sync_cards)`,
      part,
    )
    for (const r of rows) {
      const { key, updated_at, ...data } = r
      out.push({ kind: 'card', id: String(key), data, deleted: false, updatedAt: Number(updated_at ?? 0) })
    }
  }
  return out
}

async function applyIncoming(db: SyncDb, items: SyncItem[], hooks: SyncHooks, report: SyncReport) {
  if (!items.length) return
  // Своя ещё не отправленная правка той же записи новее пришедшей — пришедшую пропускаем
  const pending = new Map(
    (await db.all<{ kind: string; eid: string; at: number }>(`SELECT kind, eid, at FROM sync_outbox`)).map((o) => [
      `${o.kind}\u0000${o.eid}`,
      o.at,
    ]),
  )
  const sorted = [...items].sort((a, b) => APPLY_ORDER.indexOf(a.kind) - APPLY_ORDER.indexOf(b.kind))
  const stmts: SqlStatement[] = [setState('applying', '1')]
  // Настройки сохраняются целиком на любую мелочь (вкладка, раскрытая группа), и журнал почти всегда держит
  // свежую запись 'pref' — даже когда общие настройки не менялись. Такая запись пришедшие не перекрывает:
  // раньше из-за неё правка с другого устройства пропускалась насовсем
  const ownPrefs = hooks.readPrefs?.() ?? null
  const prefsChangedHere = !!ownPrefs && stable(ownPrefs) !== (await state(db, 'prefHash'))
  for (const it of sorted) {
    const local = pending.get(`${it.kind}\u0000${it.id}`)
    if (local != null && local > it.updatedAt && (it.kind !== 'pref' || prefsChangedHere)) continue
    report.pulled++
    report.kinds.add(it.kind)
    if (it.kind === 'pref') {
      if (it.data && hooks.applyPrefs) {
        hooks.applyPrefs(it.data)
        stmts.push(setState('prefHash', stable(it.data)))
      }
      continue
    }
    if (it.kind === 'card') {
      stmts.push(...cardSql(it))
      continue
    }
    const def = byKind.get(it.kind)
    if (!def) continue
    if (def.media && !it.deleted && it.data) {
      // Картинку — в файлы обложек устройства, в таблицу — её ключ
      const image = typeof it.data.image === 'string' ? it.data.image : null
      const art = image && hooks.saveCover ? await hooks.saveCover(image).catch(() => null) : null
      if (art) stmts.push(...def.apply({ ...it, data: { art } }))
      continue
    }
    stmts.push(...def.apply(it))
  }
  stmts.push(setState('applying', null))
  await db.batch(stmts)
}

/**
 * Карточка трека, которого нет на этом устройстве: строка в tracks с пометкой «пропал». В медиатеке её не
 * видно, а в истории, топе и статистике трек показывается с названием. Появится файл — сканер её перепишет.
 */
function cardSql(it: SyncItem): SqlStatement[] {
  if (it.deleted || !it.data) return []
  const d = it.data
  const now = Date.now()
  return [
    {
      sql: `INSERT INTO tracks (key, uri, path, file_name, title, artist, album, album_artist, genre, year, duration_ms,
              added_at, updated_at, missing_since)
            SELECT ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE key = ?)`,
      params: [
        it.id,
        (d.file_name ?? '') as SqlValue,
        (d.title ?? null) as SqlValue,
        (d.artist ?? null) as SqlValue,
        (d.album ?? null) as SqlValue,
        (d.album_artist ?? null) as SqlValue,
        (d.genre ?? null) as SqlValue,
        (d.year ?? null) as SqlValue,
        Number(d.duration_ms ?? 0),
        now,
        now,
        now,
        it.id,
      ],
    },
  ]
}
