import type { Router } from 'vue-router'
import IconOrder from '~icons/solar/sort-vertical-linear'
import IconRules from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconList from '~icons/solar/playlist-linear'
import IconAdd from '~icons/solar/add-circle-linear'
import IconImage from '~icons/solar/gallery-linear'
import IconImageOff from '~icons/solar/gallery-remove-linear'
import NameSheet from '@/components/NameSheet.vue'
import PlaylistMenuSheet from './PlaylistMenuSheet.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { pickImage } from '@/app/pick-image'
import type { PlaylistRow } from '@/data/repos/playlists'

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
