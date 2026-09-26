/**
 * Переименование отпечатков треков: все ссылки со старых ключей из key_aliases на новые.
 * Та же логика в android/…/library/TrackKey.kt (KeyAliases.fixup) — списки таблиц должны совпадать.
 */
export const KEY_COLUMNS: [table: string, column: string][] = [
  ['track_user', 'key'],
  ['play_events', 'track_key'],
  ['rating_history', 'key'],
  ['playlist_items', 'track_key'],
  ['bookmarks', 'track_key'],
  ['track_tags', 'track_key'],
  ['duels', 'a_key'],
  ['duels', 'b_key'],
  ['rank_snapshots', 'track_key'],
  ['weekly_charts', 'track_key'],
  ['analysis', 'key'],
  ['track_neighbors', 'key'],
  ['track_neighbors', 'other'],
  ['lyrics', 'key'],
  ['dismissed', 'key'],
]

export function rekeyFixupSql(): string[] {
  return [
    ...KEY_COLUMNS.map(
      ([t, c]) =>
        `UPDATE OR IGNORE ${t} SET ${c} = (SELECT new FROM key_aliases WHERE old = ${t}.${c}) WHERE ${c} IN (SELECT old FROM key_aliases)`,
    ),
    'UPDATE OR IGNORE tracks SET key = (SELECT new FROM key_aliases WHERE old = tracks.key) WHERE key IN (SELECT old FROM key_aliases)',
    'DELETE FROM tracks WHERE key IN (SELECT old FROM key_aliases)',
  ]
}
