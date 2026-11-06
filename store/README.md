# Материалы для Google Play

| Что | Где | Требование Play |
| --- | --- | --- |
| Значок | `icon/e-monogram.png` — выбран «A-волна» (остальные варианты и `_compare.png` — для истории) | 512×512, 32-бит PNG |
| Название и описания | `listing.md` | краткое ≤ 80, полное ≤ 4000 |
| Графика для описания | `play/<ru|en>/feature-1024x500.png` | 1024×500 |
| Скриншоты телефона | `play/<ru|en>/phone/` — 8 шт. | 9:16, стороны 320–3840 |
| Планшет 7″ | `play/<ru|en>/tab7/` — 7 шт. | 9:16, стороны 320–3840 |
| Планшет 10″ | `play/<ru|en>/tab10/` — 7 шт. | 9:16, стороны 1080–7680 |

Все файлы меньше 8 МБ. Номер в имени файла задаёт порядок загрузки.

## Как пересобрать

```sh
cd store/tools && npm i                # один раз: puppeteer-core (нужен установленный Edge)
npx vite --port 5179                   # из корня проекта, в отдельном окне
node store/tools/shots.mjs seed        # один раз: демо-медиатека, обложки, год прослушиваний
node store/tools/shots.mjs shoot       # сырые экраны → store/raw (в git не идут)
node store/tools/compose.mjs           # подписи и рамки → store/play
node store/tools/render.mjs            # значки из src/logos.html → store/icon
node store/tools/brand.mjs             # значок приложения: desktop/icon.png и Android mipmap-*.png
node store/tools/check-listing.mjs     # длины текстов
```

Подписи к кадрам — в `tools/compose.mjs` (массив `SLIDES`), шаблон кадра — `src/frame.html`.
