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
import { $t } from '@/i18n'

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
    ...(p.kind !== 'smart' ? [{ label: $t('Добавить треки'), icon: IconAdd, run: () => go(`/playlist/${p.id}/add`) }] : []),
    ...(p.kind === 'smart' ? [{ label: $t('Условия'), icon: IconRules, run: () => go(`/playlist/${p.id}/rules`) }] : []),
    ...(p.kind !== 'smart' ? [{ label: $t('Изменить порядок'), icon: IconOrder, run: () => go(`/playlist/${p.id}/order`) }] : []),
    ...(p.kind === 'mix' ? [{ label: $t('Редактор стыков'), icon: IconMix, run: () => go(`/mix/${p.id}`) }] : []),
    // Стыки хранятся у треков и не теряются: обратно в микс — и переходы на месте
    ...(p.kind === 'manual'
      ? [{ label: $t('Сделать миксом'), icon: IconMix, run: () => convert(p, 'mix') }]
      : p.kind === 'mix'
        ? [{ label: $t('Сделать обычным плейлистом'), icon: IconList, run: () => convert(p, 'manual') }]
        : []),
    { label: p.cover ? $t('Другая обложка') : $t('Обложка'), icon: IconImage, run: () => void chooseCover(p) },
    ...(p.cover ? [{ label: $t('Убрать обложку'), icon: IconImageOff, run: () => void setCover(p, null) }] : []),
    {
      label: p.pinPos != null ? $t('Открепить') : $t('Закрепить наверху'),
      icon: IconPin,
      run: () => {
        ui.closeSheet()
        void playlists.pin(p, p.pinPos == null)
      },
    },
    { label: $t('В группу…'), icon: IconFolder, run: () => ui.openSheet(GroupPickSheet, { playlist: p }) },
    // На компьютере порядок меняют перетаскиванием в меню слева, на телефоне — этими пунктами
    ...(!isDesktop && nudge(playlists.tree, p, -1)
      ? [{ label: $t('Поднять в списке'), icon: IconUp, run: () => move(p, -1) }]
      : []),
    ...(!isDesktop && nudge(playlists.tree, p, 1)
      ? [{ label: $t('Опустить в списке'), icon: IconDown, run: () => move(p, 1) }]
      : []),
  ]
  ui.openSheet(PlaylistMenuSheet, {
    name: p.name,
    actions,
    onRename: () =>
      ui.openSheet(NameSheet, {
        title: $t('Переименовать'),
        initial: p.name,
        confirm: $t('Сохранить'),
        onDone: (v: string) => playlists.rename(p.id, v),
      }),
    onDelete: async () => {
      await playlists.remove(p.id)
      ui.toast($t('«{0}» удалён', p.name))
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
      kind === 'mix'
        ? $t('«{0}» теперь микс: стыки настраиваются в редакторе', pl.name)
        : $t('«{0}» теперь обычный плейлист', pl.name),
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
      ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
    } finally {
      URL.revokeObjectURL(img.url)
    }
  }

  async function setCover(pl: PlaylistRow, art: string | null) {
    ui.closeSheet()
    await playlists.setCover(pl.id, art)
    ui.toast(art ? $t('Обложка плейлиста обновлена') : $t('Обложка убрана'))
  }
}

/** Меню группы плейлистов: свернуть, новый плейлист в ней, переименовать, удалить (плейлисты остаются) */
export function openGroupMenu(g: PlaylistGroupRow, router: Router): void {
  const ui = useUi()
  const playlists = usePlaylists()
  const collapsed = playlists.isCollapsed(g.createdAt)
  ui.openSheet(PlaylistMenuSheet, {
    name: g.name,
    deleteNote: $t('Плейлисты из неё останутся.'),
    actions: [
      {
        label: collapsed ? $t('Развернуть') : $t('Свернуть'),
        icon: IconFold,
        run: () => {
          ui.closeSheet()
          playlists.setCollapsed(g.createdAt, !collapsed)
        },
      },
      {
        label: $t('Новый плейлист в группе'),
        icon: IconAdd2,
        run: () =>
          ui.openSheet(NameSheet, {
            title: $t('Новый плейлист'),
            initial: '',
            confirm: $t('Создать'),
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
        title: $t('Переименовать группу'),
        initial: g.name,
        confirm: $t('Сохранить'),
        onDone: (v: string) => playlists.renameGroupTo(g.createdAt, v),
      }),
    onDelete: async () => {
      await playlists.removeGroup(g.createdAt)
      ui.toast($t('Группа «{0}» удалена, плейлисты на месте', g.name))
    },
  })
}

/** Новая группа: имя — и она появляется первой в списке */
export function createGroupDialog(): void {
  const ui = useUi()
  const playlists = usePlaylists()
  ui.openSheet(NameSheet, {
    title: $t('Новая группа'),
    initial: '',
    confirm: $t('Создать'),
    placeholder: $t('Например, «Для бега»'),
    onDone: (name: string) => playlists.addGroup(name),
  })
}
