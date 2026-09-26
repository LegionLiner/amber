import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import globals from 'globals'

/**
 * Линтер: рекомендованные правила Vue и TypeScript, форматирование — дело Prettier.
 * Запуск: npm run lint
 */
export default defineConfigWithVueTs(
  { name: 'app/files', files: ['**/*.{ts,mts,vue}'] },
  { name: 'app/ignores', ignores: ['dist/**', 'android/**', 'node_modules/**', 'coverage/**'] },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    name: 'app/rules',
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Однословные имена у нас — экраны и листы с понятным контекстом (Shelf, Welcome…)
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Пустые catch с комментарием — осознанное «не критично»
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  skipFormatting,
)
