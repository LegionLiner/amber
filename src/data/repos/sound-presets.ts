import { all, batch } from '../db'
import type { SoundPreset } from '@/domain/effects'
import type { SqlStatement } from '@/native/types'

/**
 * Свои пресеты звука в таблице sound_presets (миграция 8): каждый пресет — отдельная запись синхронизации,
 * поэтому наборы с телефона и компьютера складываются, а удалённый на одном исчезает и на другом.
 * Интерфейс по-прежнему работает со списком settings.s.soundPresets; здесь — его запись и чтение.
 */

interface Row {
  id: string
  name: string
  data: string
  pos: number | null
}

function toPreset(r: Row): SoundPreset | null {
  try {
    const d = JSON.parse(r.data) as Pick<SoundPreset, 'speed' | 'pitch' | 'effects'>
    return { id: r.id, name: r.name, speed: Number(d.speed) || 1, pitch: Number(d.pitch) || 1, effects: d.effects ?? {} }
  } catch {
    return null
  }
}

const dataOf = (p: SoundPreset) => JSON.stringify({ speed: p.speed, pitch: p.pitch, effects: p.effects ?? {} })

export async function loadSoundPresets(): Promise<SoundPreset[]> {
  const rows = await all<Row>(`SELECT id, name, data, pos FROM sound_presets ORDER BY pos, updated_at, id`)
  return rows.map(toPreset).filter((p): p is SoundPreset => !!p)
}

/**
 * Сохранить список как есть: меняются только строки, которые действительно стали другими
 * (а значит, в синхронизацию уходят только они). Порядок — позиция в списке
 */
export async function saveSoundPresets(list: SoundPreset[]): Promise<void> {
  const rows = await all<Row>(`SELECT id, name, data, pos FROM sound_presets`)
  const old = new Map(rows.map((r) => [r.id, r]))
  const now = Date.now()
  const out: SqlStatement[] = []
  const keep = new Set<string>()
  list.forEach((p, i) => {
    keep.add(p.id)
    const data = dataOf(p)
    const r = old.get(p.id)
    if (r && r.name === p.name && r.data === data && r.pos === i) return
    out.push({
      sql: `INSERT INTO sound_presets (id, name, data, pos, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, pos = excluded.pos, updated_at = excluded.updated_at`,
      params: [p.id, p.name, data, i, now],
    })
  })
  for (const r of rows) if (!keep.has(r.id)) out.push({ sql: `DELETE FROM sound_presets WHERE id = ?`, params: [r.id] })
  if (out.length) await batch(out)
}
