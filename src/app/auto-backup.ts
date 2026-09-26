import { MusicCore } from '@/native/music-core'
import { buildBackup } from '@/data/backup'
import { localParts } from '@/domain/counting'
import { useSettings } from '@/stores/settings'

/**
 * Автобэкап: раз в день при первом открытии приложения JSON со всеми данными
 * пишется в выбранную папку (на телефоне — через системный выбор папки, доступ сохраняется).
 * Хранятся последние N копий, старые удаляет движок.
 */
export async function runAutoBackup(force = false): Promise<string | null> {
  const s = useSettings().s
  const b = s.backup
  if (!b.enabled || !b.folderUri) return null
  const today = localParts(Date.now()).localDay
  if (!force && b.lastAt && localParts(b.lastAt).localDay === today) return null
  const data = await buildBackup()
  const res = await MusicCore.writeBackup({ folderUri: b.folderUri, json: JSON.stringify(data), keep: b.keep })
  b.lastAt = Date.now()
  return res.uri
}
