import { contextBridge, ipcRenderer } from 'electron'

/**
 * Мост для страницы (window.amberDesktop). Описание и типы — src/native/desktop/bridge.ts.
 * Здесь только переброска вызовов в главный процесс: страница не получает ни Node, ни прямого доступа к диску.
 */
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('amberDesktop', {
  folders: () => invoke('folders:list'),
  addFolder: () => invoke('folders:add'),
  removeFolder: (p: string) => invoke('folders:remove', p),
  walk: () => invoke('folders:walk'),
  onFilesChanged: (cb: () => void) => void ipcRenderer.on('files:changed', () => cb()),
  read: (p: string, start: number, end: number) => invoke('file:read', p, start, end),
  write: (p: string, data: Uint8Array) => invoke('file:write', p, data),
  trash: (p: string) => invoke('file:trash', p),
  reveal: (p: string) => invoke('file:reveal', p),

  readDb: () => invoke('db:read'),
  writeDb: (data: Uint8Array) => invoke('db:write', data),
  readDbBackup: () => invoke('db:readBackup'),
  quarantineDb: () => invoke('db:quarantine'),
  onFlush: (cb: () => Promise<void>) =>
    void ipcRenderer.on('app:flush', () => {
      void cb().finally(() => ipcRenderer.send('app:flushed'))
    }),

  chooseFolder: (title: string) => invoke('dialog:folder', title),
  saveFile: (name: string, data: Uint8Array) => invoke('dialog:save', name, data),
  openFile: (extensions: string[]) => invoke('dialog:open', extensions),
  writeBackup: (folder: string, name: string, json: string, keep: number) => invoke('backup:write', folder, name, json, keep),

  info: () => invoke('app:info'),
  setCloseToTray: (v: boolean) => invoke('app:closeToTray', v),
  setTitleBar: (c: { bg: string; ink: string }) => ipcRenderer.send('app:titlebar', c),
  nowPlaying: (s: { playing: boolean; title: string; artist: string }) => ipcRenderer.send('app:nowPlaying', s),
  onCommand: (cb: (cmd: string) => void) => void ipcRenderer.on('command', (_e, cmd: string) => cb(cmd)),
  setLang: (l: 'ru' | 'en') => ipcRenderer.send('app:lang', l),
  quit: () => ipcRenderer.send('app:quit'),

  ytInfo: (url: string) => invoke('yt:info', url),
  ytDownload: (url: string, names: { title: string; artist: string }) => invoke('yt:download', url, names),
  onYtProgress: (cb: (p: unknown) => void) => void ipcRenderer.on('yt:progress', (_e, p) => cb(p)),

  fileSyncState: () => invoke('fs:get'),
  fileSyncSet: (patch: unknown) => invoke('fs:set', patch),
  fileSyncPair: () => invoke('fs:pair'),
  hubLocal: () => invoke('hub:local'),
  fileSyncUnpair: (id: string) => invoke('fs:unpair', id),
  onFileSyncActivity: (cb: (a: unknown) => void) => void ipcRenderer.on('fs:activity', (_e, a) => cb(a)),

  voicePrepare: (lang: 'ru' | 'en') => invoke('voice:prepare', lang),
  onVoiceProgress: (cb: (p: unknown) => void) => void ipcRenderer.on('voice:progress', (_e, p) => cb(p)),
})
