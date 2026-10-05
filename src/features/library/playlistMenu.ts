import type { Router } from 'vue-router'
import IconOrder from '~icons/solar/sort-vertical-linear'
import IconRules from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconList from '~icons/solar/playlist-linear'
import IconAdd from '~icons/solar/add-circle-linear'
import IconImage from '~icons/solar/gallery-linear'
import IconImageOff from '~icons/solar/gallery-remove-linear'
import IconPin from '~icons/solar/pin-linear'
import IconFolder from '~icons/solar/move-to-folder-linear'
import IconUp from '~icons/solar/arrow-up-linear'
import IconDown from '~icons/solar/arrow-down-linear'
import IconFold from '~icons/solar/alt-arrow-down-linear'
import IconAdd2 from '~icons/solar/add-circle-linear'
import NameSheet from '@/components/NameSheet.vue'
import PlaylistMenuSheet from './PlaylistMenuSheet.vue'
import GroupPickSheet from './GroupPickSheet.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { isDesktop } from '@/native/desktop/bridge'
import { pickImage } from '@/app/pick-image'
import { nudge } from '@/domain/playlist-tree'
import type { PlaylistGroupRow, PlaylistRow } from '@/data/repos/playlists'

/**
 * Меню плейлиста: со страницы плейлиста (кнопка ⋯) и по удержанию в списке плейлистов.
 * onDeleted — что делать после удаления (со страницы — уйти назад).
 */
export function openPlaylistMenu(p: PlaylistRow, router: Router, onDeleted?: () => void): void {
  const ui = useUi()
  const playlists = usePlaylists()
  const go = (path: string) => {
    ui.closeSheet()
    void router.push(path)
  }
  const actions = [
    ...(p.kind !== 'smart' ? [{ label: 'Добавить треки', icon: IconAdd, run: () => go(`/playlist/${p.id}/add`) }] : []),
    ...(p.kind === 'smart' ? [{ label: 'Условия', icon: IconRules, run: () => go(`/playlist/${p.id}/rules`) }] : []),
    ...(p.kind !== 'smart' ? [{ label: 'Изменить порядок', icon: IconOrder, run: () => go(`/playlist/${p.id}/order`) }] : []),
    ...(p.kind === 'mix' ? [{ label: 'Редактор стыков', icon: IconMix, run: () => go(`/mix/${p.id}`) }] : []),
    // Стыки хранятся у треков и не теряются: обратно в микс — и переходы на месте
    ...(p.kind === 'manual'
      ? [{ label: 'Сделать миксом', icon: IconMix, run: () => convert(p, 'mix') }]
      : p.kind === 'mix'
        ? [{ label: 'Сделать обычным плейлистом', icon: IconList, run: () => convert(p, 'manual') }]
        : []),
    { label: p.cover ? 'Другая обложка' : 'Обложка', icon: IconImage, run: () => void chooseCover(p) },
    ...(p.cover ? [{ label: 'Убрать обложку', icon: IconImageOff, run: () => void setCover(p, null) }] : []),
    {
      label: p.pinPos != null ? 'Открепить' : 'Закрепить наверху',
      icon: IconPin,
      run: () => {
        ui.closeSheet()
        void playlists.pin(p, p.pinPos == null)
      },
    },
    { label: 'В группу…', icon: IconFolder, run: () => ui.openSheet(GroupPickSheet, { playlist: p }) },
    // На компьютере порядок меняют перетаскиванием в меню слева, на телефоне — этими пунктами
    ...(!isDesktop && nudge(playlists.tree, p, -1) ? [{ label: 'Поднять в списке', icon: IconUp, run: () => move(p, -1) }] : []),
    ...(!isDesktop && nudge(playlists.tree, p, 1) ? [{ label: 'Опустить в списке', icon: IconDown, run: () => move(p, 1) }] : []),
  ]
  ui.openSheet(PlaylistMenuSheet, {
    name: p.name,
    actions,
    onRename: () =>
      ui.openSheet(NameSheet, {
        title: 'Переименовать',
        initial: p.name,
        confirm: 'Сохранить',
        onDone: (v: string) => playlists.rename(p.id, v),
      }),
    onDelete: async () => {
      await playlists.remove(p.id)
      ui.toast(`«${p.name}» удалён`)
      onDeleted?.()
    },
  })

  function move(pl: PlaylistRow, dir: -1 | 1) {
    ui.closeSheet()
    void playlists.shift(pl, dir)
  }

  async function convert(pl: PlaylistRow, kind: 'mix' | 'manual') {
    ui.closeSheet()
    await playlists.setKind(pl.id, kind)
    ui.toast(
      kind === 'mix' ? `«${pl.name}» теперь микс: стыки настраиваются в редакторе` : `«${pl.name}» теперь обычный плейлист`,
    )
  }

  async function chooseCover(pl: PlaylistRow) {
    ui.closeSheet()
    const img = await pickImage()
    if (!img) return
    try {
      const { art } = await MusicCore.saveCover({ data: img.base64 })
      await setCover(pl, art)
    } catch (e) {
      ui.toast(`Не получилось: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      URL.revokeObjectURL(img.url)
    }
  }

  async function setCover(pl: PlaylistRow, art: string | null) {
    ui.closeSheet()
    await playlists.setCover(pl.id, art)
    ui.toast(art ? 'Обложка плейлиста обновлена' : 'Обложка убрана')
  }
}

/** Меню группы плейлистов: свернуть, новый плейлист в ней, переименовать, удалить (плейлисты остаются) */
export function openGroupMenu(g: PlaylistGroupRow, router: Router): void {
  const ui = useUi()
  const playlists = usePlaylists()
  const collapsed = playlists.isCollapsed(g.createdAt)
  ui.openSheet(PlaylistMenuSheet, {
    name: g.name,
    deleteNote: 'Плейлисты из неё останутся.',
    actions: [
      {
        label: collapsed ? 'Развернуть' : 'Свернуть',
        icon: IconFold,
        run: () => {
          ui.closeSheet()
          playlists.setCollapsed(g.createdAt, !collapsed)
        },
      },
      {
        label: 'Новый плейлист в группе',
        icon: IconAdd2,
        run: () =>
          ui.openSheet(NameSheet, {
            title: 'Новый плейлист',
            initial: '',
            confirm: 'Создать',
            onDone: async (name: string) => {
              const id = await playlists.create(name, [])
              const p = playlists.list.find((x) => x.id === id)
              if (p) await playlists.moveToGroup(p, g.createdAt)
              playlists.setCollapsed(g.createdAt, false)
              void router.push(`/playlist/${id}`)
            },
          }),
      },
    ],
    onRename: () =>
      ui.openSheet(NameSheet, {
        title: 'Переименовать группу',
        initial: g.name,
        confirm: 'Сохранить',
        onDone: (v: string) => playlists.renameGroupTo(g.createdAt, v),
      }),
    onDelete: async () => {
      await playlists.removeGroup(g.createdAt)
      ui.toast(`Группа «${g.name}» удалена, плейлисты на месте`)
    },
  })
}

/** Новая группа: имя — и она появляется первой в списке */
export function createGroupDialog(): void {
  const ui = useUi()
  const playlists = usePlaylists()
  ui.openSheet(NameSheet, {
    title: 'Новая группа',
    initial: '',
    confirm: 'Создать',
    placeholder: 'Например, «Для бега»',
    onDone: (name: string) => playlists.addGroup(name),
  })
}
