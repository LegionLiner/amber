import { reactive } from 'vue'

/** Состояние запуска: пока ready = false, экраны показывают заглушку */
export const bootState = reactive({ ready: false, error: '' as string })
