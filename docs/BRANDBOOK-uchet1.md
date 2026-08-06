# Брендбук · Учёт №1

**Продукт:** Учёт №1 (WMS / CRM / продажи) · домен `https://uchetn1.ru` (live-контур также `1c.pnevmopodveska1.ru`)  
**Клиент / контур:** Пневмоподвеска · pnevmopodveska1  
**Дата:** 2026-07-19  
**Источник истины по бренду:** этот файл (токены UI, логотипы, тон)

---

## 1. Суть марки

**Официальный знак:** круг, в него **вписана** крупная цифра **«1»** по центру; к её стволу **прижата** мелкая метка **«n.»** (намёк на домен `uchetn1.ru`). Не равновесное «N1» и не два глифа одного размера.

- Круглый контейнер (полный `circle` в viewBox `64`).
- «1» занимает ~⅔–¾ высоты круга, с внутренним inset; верхний флажок и нижняя площадка — читаемость на 16–32 px (favicon).
- «n.» — вторичный знак (~⅕ высоты «1»), в нише под флажком, вплотную к левой грани ствола; точка — в зазоре между «n» и «1».

Имя продукта рядом с знаком: **«Учёт №1»** (кириллица, буква «№»). Не писать «Uchet1» / «Anti1C» в UI клиента.

---

## 2. Файлы логотипа

| Файл | Назначение |
|------|------------|
| `web/public/logo-uchet1.svg` | Основной знак (teal → deep teal, белые «1» + «n.») |
| `web/public/logo-uchet1-on-dark.svg` | На тёмном фоне / dark theme (яркий teal, тёмные «1» + «n.») |
| `web/public/favicon.svg` | Favicon = тот же знак, что основной |
| `web/public/logo-rubtsov.svg` | Партнёр / подвал rubtsov.pro — **не** путать с продуктом |
| `web/public/logo-anti1c.svg` | Шуточный / внутренний — **не** в клиентский chrome |

URL на проде: `/logo-uchet1.svg`, `/logo-uchet1-on-dark.svg`, `/favicon.svg`.

### Размеры

| Контекст | Размер |
|----------|--------|
| Favicon / tab | 16–32 CSS px (SVG) |
| Header legacy (`legacy.html`) | 26×26 |
| Login | 48×48 |
| `/pick` header | 36×36 |
| Минимум читаемости | **16×16**; ниже — только монохромный круг без «1» не использовать |

### Clear space

Вокруг знака — не меньше **¼ диаметра** круга до чужих границ/текста. Не обводить лишней рамкой, не класть на busy-фото без подложки.

### Светлая / тёмная

- Light UI, светлые карточки → `logo-uchet1.svg`
- Dark theme (`data-theme="dark"` на `/pick`), тёмный header → `logo-uchet1-on-dark.svg`
- Не инвертировать основной SVG фильтрами — брать готовый вариант

---

## 3. Цвета

### Shell / taxi (legacy + React)

Из `web/public/styles.css` / `web/src/shared/styles/taxi.css`:

| Токен | Hex | Роль |
|-------|-----|------|
| `--brand` | `#0f766e` | Основной teal |
| `--brand-deep` | `#0d9488` | Акцент / вкладки |
| `--brand-dark` | `#134e4a` | Глубина градиента / press |
| `--brand-soft` | `#ccfbf1` | Soft fill / select |
| `--brand-hover` | `#115e59` | Hover primary |
| `--header-bg` | `#0f172a` | Шапка |
| `--side-bg` | `#111827` | Сайдбар |
| `--taxi-workspace` | `#f1f5f9` | Рабочая область |
| `--taxi-ink` | `#1e293b` | Текст |
| `--taxi-muted` | `#64748b` | Вторичный текст |
| `--taxi-line` | `#cbd5e1` | Линии |
| `--ok` | `#047857` | Успех |
| `--danger` | `#dc2626` | Ошибка |

### `/pick` (warehouse chrome)

| Токен | Light | Dark |
|-------|-------|------|
| `--bg` / `--bg2` | `#e8f0f0` / `#d4e4e4` | `#0c1414` / `#132020` |
| `--card` | `#ffffff` | `#1a2828` |
| `--text` | `#0f1f1f` | `#e8f4f4` |
| `--muted` | `#5a6f6f` | `#8aa0a0` |
| `--line` | `#b8cece` | `#2a4040` |
| `--accent` | `#0d7377` | `#2dd4bf` |
| `--accent-soft` | `#c5e8e9` | `#134e4a` |
| `--ok` | `#1b8a5a` | `#22a06b` |
| `--bad` | `#c0392b` | `#ef4444` |
| `--warn` | `#c47a12` | `#f59e0b` |
| Urgency overdue / hot / wait | `#b91c1c` / `#c2410c` / `#64748b` | светлее аналоги |

**theme-color / meta:** light `#0d7377`, dark `#0c1414`.

### Тёмная схема (dark) — кратко

Атрибут `data-theme="dark"` на `<html>` в `/pick`. Токены совпадают с градиентом `logo-uchet1-on-dark.svg` (`#2dd4bf` → `#0d9488`, цифра `#042f2e`).

| Роль | Токен | Hex |
|------|-------|-----|
| Фон страницы | `--bg` | `#0c1414` |
| Фон градиента низ | `--bg2` | `#132020` |
| Карточки / панели | `--card` | `#1a2828` |
| Текст | `--text` | `#e8f4f4` |
| Вторичный текст | `--muted` | `#8aa0a0` |
| Рамки / разделители | `--line` | `#2a4040` |
| Акцент (кнопки, фокус) | `--accent` | `#2dd4bf` |
| Soft fill акцента | `--accent-soft` | `#134e4a` |
| Текст на primary teal | — | `#042f2e` |

Логотип в dark: только `logo-uchet1-on-dark.svg`. Не инвертировать light SVG фильтрами.

### Запрещённые клише (UI)

- Фиолетовые / indigo градиенты «AI default»
- Vite purple favicon
- Cream + terracotta «editorial» стек
- Glow / neon / glassmorphism ради красоты
- Жёлтый taxi-1С как основной бренд (исторически ушли на slate/teal)

---

## 4. Типографика

| Роль | Стек | Где |
|------|------|-----|
| Display / заголовки shell | **Montserrat** 500–800 | legacy, login, React taxi |
| UI / таблицы | **Roboto** 400–700 | shell |
| Mono | **Roboto Mono** | коды, SKU |
| `/pick` (склад, без Google Fonts) | SF Pro Text / Segoe UI / system-ui | мобильный chrome |

Заголовки продукта: вес 700–800, лёгкий negative tracking. Не Inter/Roboto как единственный «безликий» display на маркетинговых поверхностях; в ERP-shell Montserrat+Roboto — норма.

---

## 5. Отступы и радиусы

| | Shell | `/pick` |
|--|-------|---------|
| Radius контролов | `--radius: 6px` | кнопки 12px, панели 16px |
| Tap target склад | — | `--tap: 72px` (огромные OK/Fail) |
| Toolbar tools | — | `min-height: 48px` |
| Gap chrome | плотный 1С-like | 8–12px |

Складской UI (`/pick`) намеренно **крупнее** desktop shell: перчатки, яркий свет, один тап.

---

## 6. Кнопки

**Shell (primary):** фон `--brand`, бордер `--brand-dark`, hover `--brand-hover`, текст белый.

**`/pick`:**

- `.btn-tool` — нейтральная карточка, `min-height: 48px`
- `.primary-tool` — `--accent`; в dark текст `#042f2e` на ярком teal
- `.btn-ok` / `.btn-bad` — зелёный / красный на всю ширину ряда, `min-height: var(--tap)`
- Тема `#theme-btn`: большой hit-area, **маленький** emoji (`.theme-ico` scale ~0.72), подпись 13px

Не делать primary фиолетовым. Не уменьшать tap на `/pick` ради «красоты».

---

## 7. Do / Don’t

### Do

- Знак = круг + крупная вписанная «1» + мелкая «n.» у ствола; пути в SVG, не системный шрифт в логотипе
- Teal / slate палитра из таблицы выше
- Менять light/dark логотип файлом, не CSS-фильтром
- Ссылаться на этот брендбук в UI-задачах

### Don’t

- Дробить знак на иконку «документы + полки» (старый draft) — **устарело**
- Ставить `favicon.svg` Vite/purple
- Писать «1С» или anti-1C знак в клиентском header
- Purple-on-white / glow / glass «как у AI-лендингов»
- Мелкий «1» по центру огромного пустого круга
- «N1» / «n1» одним кеглем (равный вес буквы и цифры)

---

## 8. Где смотреть в коде

- Знак: `web/public/logo-uchet1.svg`, `logo-uchet1-on-dark.svg`, `favicon.svg`
- Pick chrome: `web/public/pick.html`
- Shell tokens: `web/public/styles.css`, `web/src/shared/styles/taxi.css`
- Login: `web/public/login.html`
- HTML-справка: `/brandbook.html` (копия для «Помощь»)

---

## 9. HTML-справка

Краткая страница для людей: `web/public/brandbook.html` → `https://uchetn1.ru/brandbook.html` (также live-контур)  
Пункт меню: **Помощь → Брендбук Учёт №1**.
