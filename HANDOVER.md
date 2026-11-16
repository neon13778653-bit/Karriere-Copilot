# HANDOVER — передача проекта «Karriere Copilot» другой ИИ-модели

> **Прочти этот документ целиком, прежде чем менять код.** Он описывает, что за проект,
> как он устроен, какие требования пользователя нельзя нарушать и где что лежит.
> Составлен в ноябре 2026 г.; обновлён после аудита (версия 0.7.0, см. §16–§20).

---

## 1. Что это за проект (кратко)

**Karriere Copilot** — десктопное веб-приложение (Next.js, запускается локально на ПК)
— ИИ-агент для поиска **работы (Arbeit)** и **Ausbildung** (профобучения) в Германии.

Ключевая идея: человек выбирает цель (работа / Ausbildung / просто чат), заполняет
поэтапную анкету-«регистрацию» (с кнопкой **«Не определился» почти в каждом вопросе**),
прикладывает Lebenslauf. Агент **глубоко анализирует анкету, запоминает человека**
(система памяти), задаёт уточняющие вопросы в чате, пока не поймёт его, и только потом
запускает поиск вакансий в интернете (реальный веб-поиск) в трёх режимах глубины:
**Легкий / Средний / MAX**. Результаты — кликабельные карточки вакансий, отсортированные
по оценке ИИ (0–100, лучшие сверху); по каждой вакансии можно задавать вопросы в чате.

Приложение **двуязычно по смыслу**: весь UI и ответы агента — на русском, а профессии,
порталы, поисковые запросы и термины — немецкие (Fachinformatiker, Realschulabschluss,
Umkreis и т.д.). Пользователь — русскоязычный человек, ищущий работу/учёбу в Германии.

**Проверенное состояние (v0.7.0):** `tsc --noEmit` и `eslint src` чисты; три смоук-теста
(`memory`, `llm/web`, `wizard`) проходят (`bun run test`). `next build` больше НЕ игнорирует
ошибки типов. Сборку целиком в среде аудита проверить не удалось: `prisma generate` скачивает
движок из интернета, а доступа не было — на обычном ПК это делает `bunx prisma db push`. Предыдущий пользовательский фидбек: «выглядит хорошо и всё, что я имел в виду,
ты сделал» + последующие доработки (список требований — в §12).

---

## 2. Как запустить

```bash
# требуется: Bun (или Node 20+), порты свободны
bun install                # или npm install
cp .env.example .env       # DATABASE_URL=file:./db/custom.db (SQLite)
bunx prisma db push        # создать/обновить схему БД
bun run dev                # next dev на http://localhost:3000
```

Прод-сборка: `bun run build` (standalone) → `bun run start`.

- БД: **SQLite** через Prisma, путь в `.env` → `DATABASE_URL=file:.../db/custom.db`.
- **Без настройки ИИ и поиска приложение не ищет вакансии.** «Встроенный» ИИ — это то, что
  настроено на ПК: файл `.z-ai-config` (среда разработки, SDK `z-ai-web-dev-sdk`) ИЛИ
  `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` в `.env`. Веб-поиск — `SEARXNG_URL` или `BRAVE_API_KEY`
  (или `.z-ai-config`). Если ничего нет — интерфейс (окно «ИИ-сервер») и тексты ошибок говорят об этом
  прямо. Подробности — §8 и `.env.example`.
- Смоук-тесты (без БД и Next): `bun run test` = `memory-smoke.ts` + `llm-smoke.ts` + `wizard-smoke.ts` + `profile-edit-smoke.ts` + `vacancy-smoke.ts` + `quality-smoke.ts` + `pipeline-smoke.ts`.
- Проверка типов: `bunx tsc --noEmit` (в `tsconfig.json` исключены `examples/`,
  `skills/`, `scripts/` — это не часть приложения).

---

## 3. Стек

| Слой | Технология |
|---|---|
| Фреймворк | Next.js 16 (App Router), React 19, TypeScript (strict) |
| UI | Tailwind CSS 4, shadcn/ui (Radix), lucide-react, framer-motion |
| Состояние | React state + localStorage (`kc-active-session`, `kc-backend`) |
| БД | Prisma + SQLite: `SearchSession`, `Message`, `Vacancy`, `PersonMemory` |
| LLM | OpenAI-совместимый API (Ollama, LM Studio, GroqCloud, OpenRouter, custom) + builtin SDK |
| Веб-поиск | `src/lib/web.ts`: SearXNG → Brave → z-ai SDK (если есть `.z-ai-config`); чтение страниц — напрямую (только публичные адреса) |
| Поток | SSE (`text/event-stream`) для анализа, поиска и чата |
| Парсинг файлов | `unpdf` (PDF), `mammoth` (DOCX), текст/RTF — регэксп |

---

## 4. Карта файлов

### Ядро логики — `src/lib/`
| Файл | Назначение |
|---|---|
| `types.ts` | **Все общие типы и константы**: `UserProfile`, `PersonModel`/`MemoryFact`/`MemorySection`/`JournalEntry`, `FactStatus`, `SweepReport`, `SessionStage` (wizard→analysis→ready→chat), `SearchMode` (`easy/medium/max`), `BackendProvider`, `MODE_META` (описания режимов), `PROVIDER_META` (URL/модели провайдеров), `GOAL_LABELS`, `AgentEvent` (SSE-события), `parseProfile`, `parseJsonArray` |
| `db.ts` | Singleton PrismaClient (`db`) |
| `emoji.ts` | `stripDecorativeEmojis(text)` — удаление декоративных эмодзи. **Критично, см. §11** |
| `profile-wizard.ts` | **Две разные анкеты**: `ausbildungQuestions()` и `jobQuestions()` (по 32 вопроса, у каждой свои вопросы, варианты и подсказки), `buildWizardQuestions(goal)` (для `chat` — только `goalPick`), `wizardStages(goal)` (названия и подзаголовки 8 этапов у каждой цели свои) + `WIZARD_STAGE_COUNT`/`DOCUMENTS_STAGE`/`CUSTOM_STAGE`, `applyClear` (сброс ответа), `profileChanges` (что изменилось + нужен ли пересчёт анализа), справочники вариантов, `applyAnswer`/`applySkip` (skipValue + `wizardSkipped[]`), `visibleQuestions`, `finalizeProfile`, `prefillFromProfile` (перенос между сессиями) |
| `person-model.ts` | **Модель человека (память агента), слой 1–2**: `SECTION_DEFS` (10 секций), `buildBasePersonModel(profile)` — детерминированное извлечение фактов из анкеты/документов (работает без ИИ), `applyAnalysisMemory` — вливание выводов ИИ (dedup), `mergeChatAnswer` — факты из ответов чата + разрешение противоречий («Немецкий: B1» → «B2» вытесняет старое), `personModelToText` — компактный текст для промптов (с пометками `[ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ]`) |
| `memory-decay.ts` | **Забывание по времени (слой 3)**: полураспад доверия `factEffective = confidence × 0.5^(дни/halfLife)`, `HALF_LIFE_BY_SECTION` (условия 90 дн. … образование 540 дн.), множители по источнику (`sourceHalfLifeFactor`), статусы fresh/aging/stale/forgotten, `sweepMemory` — «уборка» (выцветшие → `archivedFacts`, отчёт `SweepReport`), `confirmFact`/`forgetFactNow`/`restoreFact`/`purgeFact`, `recomputeDecayAware`, `factAgeLabel`, `factStatusCounts` |
| `person-store.ts` | **Перенос памяти между сессиями**: чтение/запись `PersonMemory` (key `'local'`), `loadAndSweepPersonState` (уборка по реальному времени при каждом старте), `savePersonMemory`, `prefillFromProfile` (какие поля переезжают в анкету новой сессии), `buildWelcomeBackText` («С возвращением, это наша N-я сессия…»), `modelForNewSession` |
| `analysis.ts` | **Глубокий анализ анкеты**: `deepAnalysisPrompt` (портрет, направления, strengths/constraints, confidence, вопросы, структурированная memory — строгий JSON), `runDeepAnalysis` (LLM → fallback `heuristicDeepAnalysis` по правилам), `isUnderstood` (вопросов нет ИЛИ round ≥ `MAX_ROUNDS=3`), `deepAnalysisToMarkdown`/`clarifyToMarkdown` (в т.ч. фраза «Готов начать поиск?»), `finalizePersonModel`, `extractChatMemoryUpdates` (факты из ответа чата), `chatMemoryPrompt` |
| `search.ts` | **Поисковый конвейер** `runSearchPipeline` (async-генератор AgentEvent): easy {3 запроса, 10 вакансий} / medium {6, 18} / max {11, 30, deep}; шаги understand→analyze→search→extract→**verify**(все режимы)→**fit**→rank; score — оценка LLM 0–100 |
| `llm.ts` | `llmComplete`/`llmStream` (custom OpenAI-совместимый ↔ «встроенный» ИИ: `zai` или `env`, **авто-fallback до первого токена**), `builtinMode()`, `extractJson`. Таймауты стрима — на первый токен и на паузы, не на весь ответ |
| `web.ts` | `webSearch` (SearXNG/Brave/z-ai), `inspectPage` (код ответа, редиректы, HTML+текст; не бросает исключений; защита от SSRF), `readPage`, `searchMode()` |
| `geo.ts` | Расстояния: таблица ~110 городов Германии (+ русские названия), `findCity`, `distanceKm`, `parseRadiusKm`, `locationFit` (штраф до −32 за «далеко», вдвое меньше при готовности к переезду) |
| `search-quality.ts` | Предфильтр выдачи (`preFilterHits`: соцсети, списки «1.234 вакансии», статьи, дубли адресов), `classifyHost`/`trustOf` (официальный > сайт работодателя > портал > прочее), `dedupeVacancies`, `diversify`, **`stableScore`** (воспроизводимая оценка) |
| `search-queries.ts` | Детерминированные запросы с `site:` на порталы (`buildQueries`), год Ausbildung (`ausbildungStartYear`), запросы «пошире», `mergeQueries` |
| `sources/arbeitsagentur.ts` | Официальная биржа Bundesagentur für Arbeit (публичный API): `searchArbeitsagentur`, `fetchBaDetails`, чистые парсеры |
| `cache.ts` | Дисковый кеш JSON в `db/cache` (`cached`, `cacheKey`, `pruneCache`), необязательный: любая ошибка игнорируется |
| `vacancy-intel.ts` | **Проверка вакансий (чистая логика)**: `assessLink` (ссылка ok/closed/unverified), `parseJobPostingLd` (schema.org), `detectClosedSignal`, `focusText`, `groundContact`, `normalizeDetails`, `computeFit` (рекомендация «подходит ли мне»), `parseIntel`/`intelToText` |
| `prompts.ts` | `profileToText` (анкета текстом, документы ≤4000 симв./файл), `buildChatSystemPrompt` (роль эксперта по немецкому рынку, «НЕ используй эмодзи», память + анализ + вакансии), `vacanciesToContext`, `vacancyToFocusText` |
| `sse.ts` | `sseResponse(gen)` — обёртка генератора в SSE; `readBackend(body)` — белый список провайдеров |
| `goal-sync.ts` | `resolveGoal(session)` — самозалечивание цели сессии из профиля (лечит старые записи), префиксы заголовков «Работа:»/«Ausbildung:» |

### UI-компоненты — `src/components/app/`
| Файл | Назначение |
|---|---|
| `page.tsx` (src/app) | **Главный оркестратор** (~740 строк): boot (localStorage → GET /api/sessions → welcome или восстановление сессии), все SSE-обработчики (delta/step/log/analysis/vacancies/memory/ready/error), wizard-состояние с дебаунс-PATCH 700 мс, запуск анализа/поиска, роутинг экранов: WelcomeScreen → ProfileFormPage (stage=wizard) ↔ ChatView; SettingsDialog |
| `welcome-screen.tsx` | Стартовый экран: три полосы флага Германии, карточки **«Поиск работы»** / **«Ausbildung»** / ghost **«Пропустить»** → `onChoose('job'|'ausbildung'|'skip')` |
| `sidebar.tsx` | Левая панель (всегда видна, 264px, Sheet на мобильных): «Новый поиск», история сессий с иконками цели (job/ausbildung/chat) и временем, удаление, «ИИ-сервер: …», тумблер темы |
| `profile-form.tsx` | **Анкета-«регистрация» как отдельная страница** (левая панель остаётся): этапы слева, вопросы по центру, `REVIEW_STEP` «Проверка и отправка», `MEMORY_STEP` — **вкладка «Память агента» на странице профиля**; загрузка документов (drag&drop, ≤10 МБ, ≤6 файлов, `.pdf/.docx/.doc/.txt/.md/.rtf/.csv`); бейдж «пропущено — агент учтёт сам»; счётчик «Отвечено N из M»; «Отправить агенту» |
| `chat-view.tsx` | Лента чата: markdown, стрим, прогресс поиска (чек-лист шагов + журнал), карточки «Продолжить заполнение анкеты» / «Я понял тебя — готов начать поиск. Начинаем?» (кнопки «Да, начинаем поиск» / «Сначала спрошу»), vacancy-карточки из `meta.vacancyIds`, быстрые вопросы (зависят от goal), MemoryPanel (Sheet) с бейджем «понимание X%» |
| `mode-selector.tsx` | Выбор режима Легкий/Средний/MAX (карточки из `MODE_META`, оценки времени ~30 сек / ~1 мин / ~2–3 мин) |
| `vacancy-card.tsx` | Раскрывающаяся карточка вакансии: круговой бейдж score (≥80 зелёный / ≥60 янтарный), tags, «Мнение ИИ: verdict», «Почему подходит» (reasons), «На что обратить внимание» (risks), snippet, «Открыть вакансию» (url), «Спросить в чате» (`onAsk`) |
| `memory-panel.tsx` | **Панель «Память агента»** (диалог в чате + вкладка в анкете): шапка с бейджами (понимание %, факты, устаревает, выводы, забыто, открытые вопросы, сессий), блок «Требует подтверждения» (кнопки «В силе»/«Забыть»), «Выводы, которые я сделал о тебе», секции фактов с полосками свежести и источниками, «Забыто по времени — архив» («Вернуть»/«Стереть»), открытые вопросы, «Как я забываю» (объяснение человеку), журнал памяти (последние 24 записи) |
| `settings-dialog.tsx` | Выбор ИИ-сервера: builtin (работает сразу), локальные Ollama (`localhost:11434/v1`) / LM Studio (`localhost:1234/v1`), облака GroqCloud / OpenRouter / custom; «Проверить соединение», загрузка списка моделей; ключ хранится только в localStorage |
| `markdown.tsx` | Рендер markdown-ответов (перед рендером — `stripDecorativeEmojis`, «лечит» и старые сообщения) |

### API — `src/app/api/`
| Роут | Методы | Назначение |
|---|---|---|
| `/api/sessions` | GET, POST | Список сессий / создание: goal→stage (`chat`→'chat', `job/ausbildung`→'wizard'), **перенос памяти** (`loadAndSweepPersonState` + `prefillFromProfile`), приветствие + «С возвращением» для вернувшихся, инкремент `sessionsCount` |
| `/api/sessions/[id]` | GET, PATCH, DELETE | Сессия с сообщениями (asc) и вакансиями (score desc); PATCH: profile/title/stage/goal/`syncMemory` (синхронизация долговременной памяти при отправке анкеты); эмодзи чистятся и при чтении |
| `/api/agent/analyze` | POST (SSE) | Глубокий анализ анкеты: `runDeepAnalysis` → `finalizePersonModel` → сохранение в сессию + `savePersonMemory` → события `analysis`, `memory`, `ready` |
| `/api/agent/chat` | POST (SSE) | Чат. Ветка `stage==='analysis'`: ack → `extractChatMemoryUpdates`+`mergeChatAnswer` (память) → повторный `runDeepAnalysis` → вопросы или готовность (max 3 круга). Обычный чат: `buildChatSystemPrompt` (+фокус-вакансия по `vacancyId`) → `llmStream` |
| `/api/agent/search` | POST (SSE) | Запуск `runSearchPipeline` (easy/medium/max); переиспользует сохранённый анализ (`aiAnalysis`/`aiDirections`); сохраняет вакансии и сообщения |
| `/api/agent/parse-file` | POST | Извлечение текста: PDF (`unpdf`), DOCX (`mammoth`), TXT/MD/CSV, RTF-регэксп; ≤10 МБ, ≤12 000 симв.; `.doc` — отказ с подсказкой; скан без текстового слоя → честная ошибка |
| `/api/agent/test-backend` | POST | Проверка пользовательского сервера (`POST {url}/chat/completions`, «pong», 8 c) |
| `/api/agent/models` | POST | Список моделей (`GET {url}/models`) |
| `/api/memory` | GET, POST, DELETE | **Память человека**: GET — прочитать с уборкой (`{model, profile, meta, report}`); POST — `{action: confirm|forget|restore|purge, factText, sessionId?}` (применяется к долговременной памяти И памяти сессии синхронно); DELETE — полная очистка (`deleteMany key='local'`) |
| `/api/agent/status` | GET | Что настроено: `{builtin: zai\|env\|none, search: searxng\|brave\|zai\|none}` (без ключей) |

### Прочее
- `prisma/schema.prisma` — 4 модели (см. §10).
- `src/proxy.ts` — защита `/api/*` (Host только localhost/127.0.0.1 + `ALLOWED_HOSTS`, проверка Origin у POST/PATCH/DELETE).
- `scripts/memory-smoke.ts` — смоук-тест памяти (контракт памяти).
- `scripts/llm-smoke.ts` — фейковый OpenAI-сервер: длинный поток не обрывается, замолчавший — обрывается с пояснением без дубля ответа, readPage блокирует локальные адреса.
- `scripts/profile-edit-smoke.ts` — гибкий профиль: сброс ответа, нормализация и лимиты своих разделов, `finalizeProfile({keepAnalysis})`, `profileChanges`, обновление памяти `refreshAnketaFacts` (выводы из чата/анализа сохраняются).
- `src/lib/custom-sections.ts` — свои разделы и поля: лимиты, шаблоны, `normalizeCustomSections`, `customFieldLines` (чистая логика).
- `scripts/wizard-smoke.ts` — обе анкеты (разный состав вопросов и этапов, skip везде, `recognition` только при учёбе вне Германии, подписи `profileToText` по режимам, перенос между режимами), `finalizeProfile`, запасной анализ без ИИ, эмодзи-политика.
- `scripts/wizard-drive.py`, `wizard-continue.py`, `wizard-run.sh`, `clean-emoji-db.py` — служебные скрипты разработки (не часть приложения).
- `examples/`, `skills/`, `tests/`, `mini-services/`, `Caddyfile` — артефакты окружения/шаблона, **к приложению не относятся**.

---

## 5. Флоу приложения (как это работает для пользователя)

```
Старт (page.tsx boot)
  ├─ есть kc-active-session в localStorage → восстановить сессию (чат/анкета как были)
  └─ нет → WelcomeScreen
        ├─ «Поиск работы»   → POST /api/sessions {goal:'job'}        → stage=wizard → анкета
        ├─ «Ausbildung»     → POST /api/sessions {goal:'ausbildung'} → stage=wizard → анкета
        └─ «Пропустить»     → POST /api/sessions {goal:'chat'}       → stage=chat → свободный чат
                                                                     (в анкете первым вопросом будет goalPick)
Анкета (ProfileFormPage, 7 этапов + Обзор + Память агента)
  ├─ каждый ответ → applyAnswer → PATCH /api/sessions/:id (дебаунс 700 мс)
  ├─ «Не определился»/«Пропустить» на любом вопросе (skipValue или wizardSkipped[])
  ├─ этап «Документы»: Lebenslauf → /api/agent/parse-file → текст в profile.documents
  └─ «Отправить агенту» → finalizeProfile → PATCH {syncMemory:true} → POST /api/agent/analyze
        ├─ confident ≥92 и вопросов нет → stage=ready → карточка «Готов начать поиск?»
        └─ есть вопросы → stage=analysis → вопросы в чате (макс. 3 круга)
Уточняющий диалог (stage=analysis, /api/agent/chat)
  └─ каждый ответ пользователя → в память (mergeChatAnswer) → перепроверка runDeepAnalysis
Поиск
  ├─ «Да, начинаем поиск» → ModeSelector (Легкий/Средний/MAX) → POST /api/agent/search (SSE)
  └─ прогресс-чеклист → карточки вакансий (score desc) → клик → детали → «Спросить в чате»
Любой момент: панель «Память агента» (подтвердить/забыть/вернуть/стереть факты), настройки ИИ-сервера
```

**Зависимости режима (goal) — важно не сломать:**
- **Анкеты разные по содержанию, а не только по словам** (`profile-wizard.ts`):
  - *Ausbildung*: школа и оценки (`schoolType`, `gradeAverage`, `bestSubjects`, `weakSubjects`),
    признание аттестата (`recognition`, если учился не в Германии), статус проживания (§16a, Duldung),
    вид обучения (дуальная / школьная / Teilzeit — поле `format`), пробный день / практика / EQ
    (`tryout`), начало обучения (`startDate`), Ausbildungsvergütung (`salary`).
  - *Работа*: образование и профессия по диплому (`graduation`, `qualification`), признание диплома
    (`recognition`, Anerkennung), уровень позиции Helfer/Fachkraft/Senior (`seniority`), чего избегать
    (`avoid`), опыт в Германии (`germanyExperience`), когда выйти (`startDate`), график (`format`),
    тип договора вкл. Zeitarbeit (`contract`).
  - Общие поля (имя, возраст, немецкий, город…) есть в обеих, но с разными подсказками/вариантами.
    Названия и подзаголовки этапов — `wizardStages(goal)`, не хардкодь их в UI.
  - `chat` без выбранной цели получает только `goalPick`; после выбора анкета пересобирается.
- Новое поле анкеты = поле в `UserProfile` (`types.ts`) + вопрос в нужной(ых) анкете(ах) + подпись в
  `profileToText` и факт в `buildBasePersonModel` (подписи зависят от goal) + строка в тесте.
- `prefillFromProfile(prev, goal)` переносит поле в новую сессию, только если в анкете новой цели есть такой
  вопрос и (для single) значение входит в её варианты; старт/доход/договор/уровень позиции не переносятся.
- Агент «изначально знает выбор»: goal ставится при создании сессии, все промпты
  (`goalLabel`, `profileToText`, системный промпт) и поисковые шаблоны зависят от goal.
- `goal-sync.resolveGoal` исправляет расхождения goal сессии и профиля во всех роутах.
- В UI **недопустимо** показывать «работу», когда выбран Ausbildung (это был баг из фидбека).

---

## 6. Система памяти агента (сердце проекта)

Модель памяти называется **PersonModel** («модель человека») и хранится в трёх слоях:

1. **Сырые данные** — `UserProfile` (JSON в `SearchSession.profile`) + тексты документов.
2. **Модель человека** — `PersonModel`: 10 секций (`SECTION_DEFS`: identity, education,
   languages, documents, direction, experience, location, conditions, constraints,
   motivation), каждая с фактами (`MemoryFact`: text, source, confidence 0–100, at,
   halfLifeDays, confirmedAt, forgottenAt), пробелами (`gaps`), выводами ИИ
   (`inferences` с basis), открытыми вопросами (`openQuestions`),
   `overallConfidence` 0–100 и **журналом** (`journal`: learned/inferred/clarified/
   forgotten/reconfirmed/transferred).
3. **Долговременная память** — таблица `PersonMemory` (key `'local'`): модель + снимок
   профиля + meta (sessionsCount, firstSeenAt, lastSyncAt, lastGoal).

### Конвейер памяти
```
buildBasePersonModel(анкета+документы)   ← всегда работает без ИИ (источники: «Анкета», «Файл: X»)
  → applyAnalysisMemory(выводы LLM)      ← выводы с обоснованием, уверенности секций, gaps
  → mergeChatAnswer(ответы в чате)       ← источник «Ответ в чате»; вытеснение противоречий по теме
  → personModelToText()                  ← компактный текст во ВСЕ промпты (чат, анализ, поиск)
```
- «Не определился» ⇒ в `direction` пишется факт «Профессию пока НЕ выбрал(а) — ждёт
  подбора направлений», ИИ подбирает 3–5 направлений по интересам/предметам/сильным
  сторонам (`inferences` с basis), уточняющие вопросы добирают недостающее.
- Противоречия: новая формулировка «Тема: значение» вытесняет старый факт по той же теме
  (журнал: «Уточнил: … → …»). Дедупликация по тексту — без дублей.
- Уверенности пересчитываются с учётом свежести (см. ниже): `recomputeDecayAware` —
  среднее эффективных уверенностей секции ×0.85 + худший факт ×0.15 − штраф за gaps;
  общий % — взвешенное среднее секций (direction вес 3, conditions вес 1…).

### Фича 1: Панель памяти на странице профиля
`memory-panel.tsx` → используется дважды: как Sheet-диалог из чата и как **вкладка
«Память агента»** в `ProfileFormPage` (`MEMORY_STEP = 8`). Показывает: бейджи (понимание
X%, N фактов, M устаревает, K выводов, архив, открытые вопросы, счётчик сессий), блок
«Требует подтверждения», выводы ИИ, секции с полосками свежести, архив забытого,
объяснение «Как я забываю» для человека и журнал памяти. Действия: **confirm / forget /
restore / purge** — через `POST /api/memory`, применяются синхронно к долговременной
памяти и к памяти активной сессии.

### Фича 2: Забывание устаревших фактов по времени
`memory-decay.ts`, принцип «полураспада доверия»:
`эффективная уверенность = confidence × 0.5^(дней_с_подтверждения / halfLife)`.
- Политики полураспада по секциям: identity/education 540 дн., languages 360,
  documents/experience 300, motivation 240, direction/location/constraints 150,
  **conditions (доход, формат) 90 дн.** Множитель источника: файлы ×1.15 (надёжнее),
  анкета ×1.0, «Анализ анкеты» ×0.85, «Ответ в чате» ×0.7, «Вывод ИИ» ×0.6.
- Пороги: ≥70 свежий, ≥45 давний, ≥20 «устаревает» (агент мягко перепроверяет, факт
  помечается `[ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ]` в промптах), <20 — **забыто**: факт уезжает
  в `archivedFacts` (архив, не удаление; восстановимо).
- `sweepMemory` вызывается при: загрузке панели памяти (GET /api/memory), создании
  новой сессии (`loadAndSweepPersonState`) и каждом `savePersonMemory` — забывание
  работает по реальному времени, даже если приложение молчало месяц.
- Подтверждение человеком (`confirmFact`) сбрасывает часы: `confirmedAt = сейчас`,
  возврат из архива в родную секцию (определяется `pickSectionForText` по ключевым словам).

### Фича 3: Перенос памяти между сессиями одного человека
`person-store.ts` + `POST /api/sessions`:
- При создании новой сессии загружается долговременная память `PersonMemory` key
  `'local'`, прогоняется уборка, и `prefillFromProfile` переносит в анкету новой сессии:
  имя, возраст, статус, школу/аттестат/балл/предметы/сертификаты, языки, право на работу,
  опыт/навыки/права, город/радиус/переезд/формат, интересы/ценности/сильные стороны,
  **и приложенные документы**. **Не переносится** (спрашивается заново): goal,
  decided/position, salary.
- Агент встречает человека как знакомого: `buildWelcomeBackText` → «### С возвращением,
  {имя}! Это наша N-я сессия — я помню тебя с {даты}…» + «Что я о тебе помню» (хайлайты
  из секций) + «могло устареть…» (staleNow) + «Я забыл K устаревших факт(ов)…»
  (forgottenNow) + «В анкету уже перенёс N пол(ей)».
- `modelForNewSession` гарантирует: если модель памяти есть — она переезжает целиком;
  если нет, но был профиль — строится `buildBasePersonModel`.
- Синхронизация обратно: отправка анкеты (PATCH `syncMemory:true`) и ответы в чате
  (`savePersonMemory` в роутах analyze/chat) обновляют долговременную память.

---

## 7. Глубокий анализ и «Готов начать поиск?»

`analysis.ts` + `/api/agent/analyze` + ветка analysis в `/api/agent/chat`:
1. После «Отправить агенту» — `runDeepAnalysis`: LLM получает анкету (`profileToText`),
   память (`personModelToText` с правилом «НЕ переспрашивай то, что зафиксировано») и
   последние сообщения; возвращает строгий JSON: portrait, directions (3–5 с немецкими
   названиями и keywords для поиска), strengths, constraints, confidence 0–100,
   questions (1–3), understood, memory (inferences/sectionConfidence/openQuestions).
2. `confidence > 92` разрешается ТОЛЬКО если понятны: цель/направления, язык,
   образование, локация, право на работу.
3. Не понял → `clarifyToMarkdown` («Хочу уточнить пару моментов… Отвечай прямо в чате»),
   stage=analysis. Ответы пользователя вливаются в память и анализ повторяется.
   `isUnderstood`: вопросов нет ИЛИ round ≥ `MAX_ROUNDS = 3` (форс-готовность).
4. Понял → stage=ready → карточка «Я понял тебя — готов начать поиск. Начинаем?»
   («Да, начинаем поиск» / «Сначала спрошу»). Это ровно тот флоу, что требовал
   пользователь: отправил анкету → глубокий анализ → вопросы → 100% → «Готов начать?».
5. Fallback без ИИ: `heuristicDeepAnalysis` (правила по интересам → направления),
   confidence 60 — флоу не ломается.

---

## 8. LLM-слой и провайдеры

`llm.ts`, настройка в `settings-dialog.tsx`, выбор хранится в localStorage `kc-backend`
и передаётся в теле каждого запроса (`backend`):

| Провайдер | URL | Ключ |
|---|---|---|
| `builtin` (по умолчанию) | то, что настроено на ПК: `.z-ai-config` или `LLM_*` в `.env` | зависит |
| `ollama` (локально) | `http://localhost:11434/v1` | нет |
| `lmstudio` (локально) | `http://localhost:1234/v1` | нет |
| `groq` (GroqCloud) | `https://api.groq.com/openai/v1`, модель `llama-3.3-70b-versatile` | да (console.groq.com/keys) |
| `openrouter` | `https://openrouter.ai/api/v1` | да |
| `custom` | любой OpenAI-совместимый (vLLM, llama.cpp…) | опц. |

- **Если «встроенного» ИИ нет** (`builtinMode() === 'none'`): `llmComplete` возвращает пустой текст с
  `fallbackReason`, `llmStream` отдаёт `fallbackNote` с подсказкой по настройке; вызывающий код уходит в
  эвристики. Раньше SDK без `.z-ai-config` падал молча — не возвращай такое поведение.
- **Fallback-цепочка**: custom упал ДО первого токена → встроенный (если настроен; `fallbackNote` → тост).
  Если ответ custom уже пошёл и оборвался — второй ответ **не дописывается**, пользователь получает
  пояснение «ответ оборвался». Встроенный упал → эвристики.
- **Таймауты** (`LLM_*_MS` в `.env`): первый токен 90 с, пауза внутри потока 45 с, нестриминговый вызов 240 с.
  Не вешай `AbortSignal.timeout` на весь стрим: локальные модели отвечают минутами.
- Ключи из окна настроек — только в localStorage браузера, уходят только выбранному серверу.
- Приватность: анкета, документы, чат и запросы уходят выбранному ИИ/поиску; в окне «ИИ-сервер» об этом
  написано. Новые провайдеры/логирование — без записи персональных данных в логи (SQL-лог в `db.ts` отключён).

---|---|---|
| `builtin` (по умолчанию) | SDK, работает сразу | нет |
| `ollama` (локально) | `http://localhost:11434/v1` | нет |
| `lmstudio` (локально) | `http://localhost:1234/v1` | нет |
| `groq` (GroqCloud) | `https://api.groq.com/openai/v1`, модель `llama-3.3-70b-versatile` | да (console.groq.com/keys) |
| `openrouter` | `https://openrouter.ai/api/v1` | да |
| `custom` | любой OpenAI-совместимый (vLLM, llama.cpp…) | опц. |

- **Fallback-цепочка**: custom упал → автоматически builtin (+`fallbackReason` в
  событии `backend`, тост пользователю); builtin упал → эвристики. `llmStream` умеет
  переключаться на builtin прямо посреди стрима.
- Ключи — только в localStorage браузера, никуда не отправляются кроме выбранного сервера.

---

## 9. Поиск вакансий (Легкий / Средний / MAX)

`search.ts`, `runSearchPipeline` — async-генератор `AgentEvent`, на фронте —
прогресс-чеклист (understand/analyze/search/extract/enrich/rank) + журнал:

| Режим | Запросов | Выдача | Вакансий | Чтение страниц |
|---|---|---|---|---|
| easy (Легкий) | 3 | 6/запрос | топ-10 | нет |
| medium (Средний) | 6 | 8 | топ-18 | нет |
| max (MAX) | 11 | 10 | топ-30 | топ-6 страниц + перепроверка score |

- **analyze**: LLM генерирует немецкие запросы. Шаблоны: `Ausbildung <профессия> <город>`,
  `Ausbildungsstellen <город> 2026`, `Stellenangebote <профессия> <город>`; порталы в
  промпте: ausbildung.de, aubi-plus.de, arbeitsagentur.de (для Ausbildung); indeed.com,
  stepstone.de, linkedin.com, kimeta.de, jobware.de, meinestadt.de (для работы);
  радиус → `… Umkreis arbeitsagentur`; слабый немецкий → `English speaking jobs`;
  MAX → запросы по компаниям («Top Unternehmen…»). Fallback-запросы без ИИ.
- **search**: `webSearch` батчами по 3, дедуп по нормализованному URL.
- **extract**: LLM фильтрует чанки по 25 — оставляет только РЕАЛЬНЫЕ вакансии (отбрасывает
  статьи/форумы/агрегаторы) и **ставит score 0–100 соответствия профилю** (язык, город,
  опыт, навыки, право на работу); в deep-режиме ещё verdict/reasons/risks/tags.
  «Нет зарплаты в сниппете — не выдумывай, оставь null».
- **enrich (MAX)**: `readPage` топ-6 → перепроверка оценок по содержимому страницы.
- **rank**: сортировка по score → `db.vacancy.createMany` (с `stripDecorativeEmojis`)
  → сообщение с `meta.vacancyIds` → фронт рендерит `VacancyCard` отсортированно,
  кликабельно, с «Спросить в чате» (follow-up через фокус-вакансию в промпте чата).

---

## 10. База данных (Prisma/SQLite)

- `SearchSession`: title, goal (job/ausbildung/chat), stage (wizard/analysis/ready/chat),
  profile (JSON `UserProfile`), messages[], vacancies[].
- `Message`: role, content, meta JSON (`{vacancyIds?: string[]}`, note для fallback).
- `Vacancy`: title/company/location/url/source/salary/description/snippet/score/verdict/
  reasons(JSON)/risks(JSON)/tags(JSON)/searchMode/**intel(JSON: VacancyIntel)**. После обновления до 0.6.0 нужен `bunx prisma db push`
  (добавляется необязательная колонка `intel`; старые вакансии остаются, у них просто нет проверки и рекомендации).
- `PersonMemory` (key `'local'`, один локальный пользователь): model JSON (PersonModel),
  profile JSON (снимок для переноса), lastGoal, sessionsCount, firstSeenAt, lastSyncAt.

Мультитенантности нет — намеренно: локальное десктоп-приложение для одного человека.

---

## 11. Дизайн-правила — НАРУШАТЬ НЕЛЬЗЯ

1. **Эмодзи-политика**: пользователь просил убрать «несерьёзные» эмодзи (🔥 🎯 👋 ⚖️ ⚡ 📍 👤
   и подобные). Реализовано НЕ списком, а **универсально**: `emoji.ts` вычищает все
   Unicode-эмодзи-диапазоны (U+1F000–1FAFF, U+2600–27BF, U+2B00–2BFF, часы, ‼⁉,
   variation selectors, ZWJ). Функция применяется на сохранении (chat/analyze/search),
   на чтении (sessions routes — «лечит» старые записи) и на рендере (markdown.tsx).
   В UI-компонентах эмодзи не используются — только иконки `lucide-react`.
   **При добавлении любого нового текста агента — прогоняй через `stripDecorativeEmojis`.**
2. **Языки**: UI и ответы агента — на русском; термины, профессии, запросы — немецкие.
   Тексты — на «ты» (не на «вы»).
3. **Режимозависимость**: анкета, тексты и поиск обязаны подстраиваться под goal
   (см. §5). Проверяй изменения в обоих режимах.
4. **«Не определился» везде**: любой вопрос анкеты можно пропустить; для ключевых
   вопросов есть осмысленные skipValue («Не знаю немецкого», «Вся Германия»,
   «Не определился — пусть агент оценит по рынку»). Новые вопросы анкеты обязаны
   поддерживать skip.
5. **Тон агента**: экспертный, по делу, без суеты; честно говорить о том, что забыто
   или неясно (в т.ч. «Я забыл K устаревших фактов»).
6. Тёмный zinc-сайдбар независимо от темы; акцент — немецкий флаг на welcome-экране;
   shadcn/ui-компоненты; скруглённые карточки; progress-полоски свежести в панели памяти
   (зелёный/серый/янтарный).

---

## 12. История требований пользователя (что уже согласовано — не сломать)

1. Стартовый экран нового чата: «Поиск работы» / «Ausbildung» / «Пропустить» (пропуск —
   сразу чат). ✔
2. Чат-интерфейс как у типичного ИИ-агента на ПК; левая панель сохраняется всегда,
   анкета — отдельная страница-«регистрация» с той же левой панелью. ✔
3. Агент — локальная ИИ или сервер/облако (GroqCloud и т.п.): настроенно через
   OpenAI-совместимые бэкенды + builtin. ✔
4. Режимы Легкий/Средний/MAX; MAX — искать везде, анализировать компании по тематике,
   проверять соответствие человека вакансии. ✔
5. Результаты кликабельные, отсортированы по оценке ИИ (лучшие сверху); follow-up
   вопросы по вакансии в чате. ✔
6. Поэтапная гибкая анкета; «не определился» ВЕЗДЕ; если не определился — агент
   анализирует остальные ответы и сам выводит направления. ✔
7. Поля школы/образования/среднего балла; локация город+радиус (10/25/50/100 км,
   «Вся Германия»). ✔
8. Загрузка файлов (Lebenslauf) — агент читает и понимает (PDF/DOCX/TXT/RTF). ✔
9. Флоу после заполнения: «Отправить агенту» → глубокий анализ → уточняющие вопросы в
   чате → 100% понимания → «Готов начать поиск?» → «Да» → поиск. ✔
10. Убрать смайлики 🔥🎯👋⚖️⚡📍👤 (остальные тоже вычищены универсально — см. §11.1). ✔
11. БАГ-фикс: при выбранном Ausbildung нигде не должно быть «работы» — анкета и тексты
    под Ausbildung, агент изначально знает выбор. ✔ (goal-sync, buildWizardQuestions)
12. Система памяти агента: анализ анкеты → факты/выводы/журнал; панель памяти на
    странице профиля; забывание устаревших фактов по времени; перенос памяти между
    сессиями одного человека. ✔ (§6 — три фичи реализованы и покрыты smoke-тестом)

---

## 13. Известные ограничения и roadmap (куда развивать)

1. **Веб-поиск требует настройки** (`SEARXNG_URL` или `BRAVE_API_KEY`, §2). Без неё поиск вакансий
   честно сообщает, что искать нечем. Идеи: кеш результатов поиска, ещё провайдеры (SerpAPI).
2. Один пользователь (key `'local'`), без авторизации — осознанное решение для
   десктопа. Мультитенантность потребует ключа пользователя в `PersonMemory`.
3. `next/font/google` убран (нужен интернет при сборке, а Geist не содержит кириллицы): используется системный стек шрифтов.
4. Оценки вакансий — LLM-оценка, не детерминированная формула; повторный поиск может
   дать разные баллы (это фича «мнение ИИ», но для сравнимости можно кешировать).
5. Нет тестов фронтенда и API-роутов (есть смоуки логики: память, LLM/веб, анкета + запасной анализ).
   Roadmap: интеграционный тест роутов с временной SQLite; разбить `page.tsx` (~740 строк) и
   `profile-form.tsx` (~930) на хуки/компоненты; кеш оценок вакансий.
6. Заголовки сессий — префикс «Работа:/Ausbildung:/Профиль:» + позиция/город; можно
   улучшить суммаризацией.
7.`.doc` (старый Word) не поддерживается — честная ошибка с подсказкой пересохранить.
8. Идеи пользователя на будущее: настоящий desktop-враппер (Tauri/Electron), экспорт
   Lebenslauf-данных, напоминания «пора подтвердить факты», мультиязычность UI.

---

## 14. Типовые задачи → какие файлы трогать

| Задача | Файлы |
|---|---|
| Добавить/изменить вопрос анкеты | `src/lib/profile-wizard.ts` (+ `person-model.ts`, если факт должен попасть в память) |
| Изменить поведение чата/промпт | `src/lib/prompts.ts`, `src/app/api/agent/chat/route.ts` |
| Изменить глубокий анализ | `src/lib/analysis.ts` |
| Изменить политику забывания | `src/lib/memory-decay.ts` (HALF_LIFE_BY_SECTION, пороги) |
| Добавить секцию памяти | `SECTION_DEFS` в `person-model.ts` + вес в `recomputeDecayAware` + правило переноса в `pickSectionForText` + weight-карта |
| Изменить, что переносится между сессиями | `prefillFromProfile` в `src/lib/profile-wizard.ts` (реэкспорт из `person-store.ts`) |
| Добавить провайдера ИИ | `PROVIDER_META` в `types.ts` + `settings-dialog.tsx` + белый список в `sse.ts` (`readBackend`) + `isCustomBackend` в `llm.ts` |
| Изменить режимы поиска | `MODE_CFG` в `search.ts` + `MODE_META` в `types.ts` |
| Изменить карточку вакансии | `vacancy-card.tsx` (+поля в `VacancyDTO`/schema) |
| Новое SSE-событие | `AgentEvent` в `types.ts` → генератор → обработчик в `page.tsx` (`handleEvent`) |
| Действие над памятью | `memory-decay.ts` (функция) → `api/memory/route.ts` (action) → `memory-panel.tsx` (кнопка) |

---

## 15. Как проверять свои изменения

1. `bunx tsc --noEmit` — типы (должно быть 0 ошибок; `examples/`, `skills/`, `scripts/`
   исключены из проверки сознательно).
2. `bun run test` — пять смоук-тестов (память, LLM/веб, анкета, гибкий профиль, вакансии). `bun run lint` — ESLint (в `src` должно быть 0 ошибок).
3. Ручной сценарий (dev-сервер): welcome → выбрать **Ausbildung** → анкета (проверить,
   что нигде нет «работы»; несколько вопросов пропустить) → документ-тест
   (txt/pdf) → «Отправить агенту» → ответить на уточняющие вопросы → «Да, начинаем
   поиск» → Легкий → открыть карточку вакансии → «Спросить в чате» → Профиль →
   вкладка «Память агента» → подтвердить/забыть факт → создать **новую сессию** →
   убедиться в «С возвращением» и предзаполнении анкеты.
4. Проверка эмодзи-политики: после любых текстовых правок убедиться, что в чат
   выводится только то, что прошло через `stripDecorativeEmojis`.

---

## 16. Что изменилось в версии 0.3.0 (по итогам аудита)

1. **Стриминг локальных моделей**: таймаут больше не режет весь ответ (раньше 12 с на всё тело → обрезок +
   второй ответ встроенного ИИ). Теперь таймаут на первый токен и на паузы; после частичного ответа
   дубль не дописывается (`llm.ts`, тест `llm-smoke.ts`).
2. **«Работает без ключей» было неверно**: SDK требует `.z-ai-config`. Добавлен встроенный ИИ через `LLM_*`
   в `.env`, диагностика (`/api/agent/status`, окно «ИИ-сервер», сообщения об ошибках).
3. **Веб-поиск не привязан к SDK**: SearXNG и Brave (`web.ts`), прямое чтение страниц с блокировкой
   локальных/приватных адресов (SSRF) и проверкой редиректов.
4. **Безопасность и приватность**: `dev`/`start` слушают `127.0.0.1`; `src/proxy.ts` защищает API
   (Host/Origin); SQL-лог отключён; в окне «ИИ-сервер» объяснено, что уходит наружу; `robots.txt` закрыт.
5. **Режимы**: найдены и исправлены остатки «работы» в анкете Ausbildung («Важно в работе», «формат
   работы», «опыт работы») и «Ausbildung»/«учебных мест» в режиме работы (анкета и запасной анализ).
6. **Качество**: убрано `ignoreBuildErrors`; 6 ошибок ESLint исправлены (порядок хуков в `page.tsx`,
   сброс формы настроек ремаунтом); удалены 35 неиспользуемых компонентов шаблона и ~40 зависимостей
   (было 864 пакета, стало 565); `.gitignore` не скрывает `.env.example`; пакет переименован `karriere-copilot`.
7. **Не делалось**: `bun.lock` не пересобран (в среде аудита bun не достучался до реестра) — выполни
   `bun install`, он обновит lock; полная `next build` с БД не прогонялась (см. §1).

## 17. Что изменилось в версии 0.4.0 (раздельные анкеты)

1. **Анкеты Ausbildung и работы теперь разные** (было: одни и те же 28 вопросов с подменой слов): у каждой свой
   состав вопросов, варианты ответов, подсказки и названия этапов (состав — в §5). Всего по 32 вопроса,
   часть зависит от ответов (`recognition`, ветка «не определился»).
2. **Новые поля `UserProfile`**: `weakSubjects`, `tryout` (Ausbildung); `qualification`, `seniority`,
   `germanyExperience`, `avoid`, `contract` (работа); `recognition`, `startDate` (обе, разные вопросы).
   Они попадают в `profileToText`, `buildBasePersonModel` (с подписями под режим) и в память агента.
3. **Перенос между сессиями разных режимов** больше не тащит чужие варианты ответов (`prefillFromProfile`).
4. **Исправлено по пути**: ограничение «диплом/аттестат другой страны» в запасном анализе никогда не срабатывало
   (искало «другой стране», в справочнике было «другой страны») — теперь работает по `schoolCountry`/`recognition`;
   `applySkip` больше не мутирует прежнее состояние; подзаголовки этапов в форме больше не говорят
   «для Ausbildung» в режиме работы.
5. **Совместимость**: сохранённые профили не ломаются (все старые поля на месте; новые необязательные).

## 18. Что изменилось в версии 0.5.0 (гибкий профиль)

1. **Правка любого ответа в любое время.** Кнопка «Профиль» в чате у уже проанализированной сессии (`stage` ready/chat)
   открывает форму в **режиме правки** (`profileEditMode` в `page.tsx`): стадия сессии и анализ НЕ сбрасываются, поиск
   не блокируется. Правки автосохраняются; «Проверка» показывает, что изменилось («было → стало»), и предлагает:
   - **«Сохранить изменения»** → `saveProfileEdit(false)`: `finalizeProfile(goal, draft, {keepAnalysis:true})`, PATCH с
     `refreshMemory:true` + `syncMemory:true`; сервер вызывает `refreshAnketaFacts` — обновляет только факты с
     источником «Анкета»/«Файл: …», а выводы ИИ, ответы из чата, открытые вопросы и журнал сохраняет;
   - **«Сохранить и пересчитать анализ»** → прежний путь `submitWizard`. Подсказка «нужен ли пересчёт» — из
     `profileChanges().needsReanalysis` (правка только имени пересчёта не требует).
   Кнопка «Готово, в чат» в режиме правки сама сохраняет, если что-то менялось. Пока сессия ещё не проанализирована,
   поведение прежнее (`stage: 'wizard'`).
2. **Свои поля и разделы**: новый 8-й этап «Свои разделы» (`CUSTOM_STAGE`), данные в `UserProfile.customSections`
   (JSON внутри профиля, миграция БД не нужна). Шаблоны («Проекты и работы», «Ссылки», «Волонтёрство и хобби»,
   «Особые условия») или свой раздел; лимиты в `CUSTOM_LIMITS` (8 разделов × 20 полей, значение до 1500 символов).
   Сервер при PATCH всегда нормализует разделы. Агент читает их в `profileToText` («СВОИ РАЗДЕЛЫ ПРОФИЛЯ»), в памяти
   они лежат фактами секции «Мотивация и характер» (новую секцию НЕ добавляй: пустые секции занижают общую уверенность).
3. **Гибкие ответы**: «Сбросить ответ» у любого вопроса (`applyClear`; цель `goalPick` сбросить нельзя); «Свой вариант»
   теперь есть и у вопросов с одиночным выбором (кроме `goalPick`/`decided`); **исправлено**: свои значения мультивыбора
   раньше сохранялись, но нигде не отображались — теперь видны чипами и снимаются кликом.
4. Этапов теперь 8 + «Проверка» (`REVIEW_STEP`) + «Память» (`MEMORY_STEP`). Номера этапов не хардкодь — бери
   `DOCUMENTS_STAGE`/`CUSTOM_STAGE`/`WIZARD_STAGE_COUNT`.
5. **Проверено**: типы, ESLint, 4 смоук-теста; форма отрендерена на сервере во всех режимах (правка/обычный, шаги
   «Свои разделы» и «Проверка»). **Не проверено**: живой клик по интерфейсу и PATCH-маршрут с БД (в среде аудита нет
   движка Prisma) — пройди сценарий вручную: открыть профиль проанализированной сессии → поправить ответ → «Сохранить
   изменения» → убедиться, что анализ и чат на месте, а в «Памяти агента» факт обновился.

## 19. Что изменилось в версии 0.6.0 (проверенные ссылки, подробности и рекомендация)

**Было**: ссылка бралась из выдачи поиска и не проверялась; данные — только из короткого сниппета (нет срока подачи,
требований, контактов, способа подачи); «подходит ли мне» — одна оценка 0–100 и пара фраз.

**Стало** (`search.ts` → шаги `verify` и `fit`, логика в `vacancy-intel.ts`, данные в `Vacancy.intel`):
1. **Проверка ссылок у ВСЕХ кандидатов во всех режимах** (без ИИ, 6 параллельных запросов, таймаут 10 с):
   - `closed` (исключается из списка): 404/410, срок `validThrough` в разметке JobPosting в прошлом, явная фраза
     «Stelle besetzt»/«no longer available»/«Вакансия закрыта» в начале страницы;
   - `unverified` («проверь сам», остаётся в списке): сайт не пустил бота (401/403/429), 5xx, таймаут, пустая страница
     (нужен JS/вход), редирект на главную, не веб-страница. Сайт, не пустивший бота, НЕ считается закрытым;
   - `ok`: страница открылась и признаков закрытия нет. Берём запас кандидатов (`CANDIDATE_SPARE=6`), чтобы список был полным.
2. **Подробности вакансии** (`VacancyDetails`): срок подачи, начало, дата публикации, тип занятости, длительность
   Ausbildung, зарплата/Vergütung, требуемый немецкий, образование, требования/задачи/условия, как подать, контакт.
   Источники: JSON-LD страницы (приоритет) + ИИ по тексту страницы (`pageAnalysisPrompt`, пачки по 3). Правила: нет на
   странице → null; контакт принимается только если e-mail/телефон буквально есть в тексте страницы (`groundContact`).
   Глубина: easy — только ссылки и разметка (`analyze: 0`), medium — ИИ читает 8 лучших, max — всех.
3. **Рекомендация «подходит ли мне»** (`computeFit`, `VacancyFit`): Откликайся / Откликайся, но учти пробелы / Лучше
   пропустить + что совпадает, чего не хватает, жёсткие несоответствия, что сделать перед откликом. Жёсткие правила
   (немецкий с разрывом ≥2 уровней, нужный аттестат Ausbildung, срок подачи, закрытая вакансия) считаются кодом;
   ИИ может только понизить рекомендацию; без полного текста страницы выше «maybe» не поднимаем (`basedOnPage`).
   Оценка ограничивается (`scoreCap`): блок → ≤35, «пропустить» → ≤49, «maybe» → ≤79, чтобы сортировка не спорила с советом.
4. **Интерфейс**: в карточке бейджи «Ссылка проверена / Ссылку проверь сам / Неактуальна» и рекомендация, блок
   «Подходит ли тебе», блок «Главное о вакансии» с пометкой «со страницы» или «из краткой выдачи», строка о проверке и
   напоминание сверить срок на сайте. Агент в чате получает те же данные (`intelToText`) и обязан не выдумывать
   отсутствующее (см. `buildChatSystemPrompt`).
5. **Честные ограничения**: многие порталы (Indeed, StepStone и др.) блокируют ботов или строят страницу JavaScript-ом —
   такие ссылки получат «проверь сам», а подробности останутся из краткой выдачи. Страницы крупных порталов часто
   меняют разметку; для них мало смысла улучшать разбор — лучше добавить прямые источники (Arbeitsagentur, ausbildung.de).
   Поиск стал дольше (проверка ссылок ≈ до минуты на 36 кандидатов). Проверка — момент во времени: вакансия может
   закрыться позже, поэтому в карточке указано время проверки.
6. **Проверено**: типы, ESLint, 5 смоук-тестов (58 проверок вакансий, включая реальные HTTP-сценарии на локальном
   сервере: 404, 403, редирект, главная, не-HTML, таймаут, истёкший срок), карточка отрендерена во всех состояниях.
   **Не проверено**: полный прогон `runSearchPipeline` с БД и живым ИИ (нет Prisma-движка в среде аудита) — сделай один
   поиск в режиме Medium и проверь бейджи, срок подачи и блок рекомендации в карточке.

## 20. Что изменилось в версии 0.7.0 (качество поиска)

**Найдена и исправлена серьёзная ошибка**: ИИ нумерует вакансии внутри блока (1–25), а код сопоставлял номера со всем
списком — в режимах Medium и MAX данные вакансий из 2-го и следующих блоков прилипали к ссылкам 1-го блока (чужие
ссылки у вакансий или потерянные вакансии). Теперь номер приводится к общему (`extracted.push(... i + offset)`);
сквозной тест `pipeline-smoke.ts` падает, если вернуть старое поведение.

Что улучшено (всё — в `search.ts`, логика в отдельных проверяемых модулях):
1. **Официальный источник — Arbeitsagentur** (angebotsart 4 = Ausbildung, 1 = работа; город, радиус, координаты, дата
   публикации, начало). Вакансия в её выдаче опубликована сейчас, поэтому ссылка помечается «проверена» без открытия
   страницы (она строится JavaScript-ом); текст берётся из API деталей. Данные биржи перекрывают разбор ИИ.
   ⚠ **Формат API я знаю по документации bund.dev и проверил только на заглушке** (в среде аудита нет доступа к
   rest.arbeitsagentur.de). Парсер защитный, любая ошибка = пустой результат, поиск продолжится через веб. После
   первого запуска посмотри в логе строку «Arbeitsagentur «…» — N вакансий»: если там «недоступна» или 0, сверь
   параметры в `buildBaSearchUrl`.
2. **Запросы**: основа строится кодом по шаблонам с `site:` (ausbildung.de, arbeitsagentur.de, azubiyo.de, StepStone,
   Indeed, kimeta, сайты работодателей), год Ausbildung считается автоматически (с октября — следующий), слабый
   немецкий добавляет «English speaking»/«Einstiegsqualifizierung». ИИ дополняет вариантами (temperature 0). Если
   ссылок мало — второй заход «пошире» (без города).
3. **Предфильтр до ИИ**: соцсети/форумы, страницы-списки, статьи про зарплату, повторы адресов (без трекинга). Если
   осталось <10 ссылок, часть списков возвращается (соцсети — никогда). Дубли одной вакансии на разных порталах
   схлопываются (остаётся самый надёжный источник); не больше 3 вакансий от одной компании.
4. **Стабильные оценки**: ИИ ставит ступени `relevance` 0–4 (и `requirementsFit` по странице), число считает
   `stableScore` (ступень + расстояние + возраст + доверие к источнику; «сырая» оценка ИИ — лишь 20%). Сдвиг сырой
   оценки на 15 пунктов меняет итог ≤3. Все вызовы ИИ в поиске идут с temperature 0.
5. **Расстояние**: от города из профиля до места вакансии (готовое от биржи, координаты или город из текста); дальше
   радиуса — штраф и пометка «Далеко: ~X км», рядом — «Недалеко». Неизвестный город не штрафуется.
6. **Кеш** (`db/cache`, 6 ч по умолчанию, `SEARCH_CACHE_HOURS`, `0` = выкл.): веб-поиск, Arbeitsagentur, разбор ИИ.
   Повторный поиск быстрее, дешевле и даёт те же результаты. Неудачные (пустые) ответы не кешируются.
7. **Проверено**: `quality-smoke.ts` (66 проверок), **`pipeline-smoke.ts`** — настоящий `runSearchPipeline` на заглушках
   БД/DNS/SearXNG/Arbeitsagentur/сайтов/ИИ (22 проверки: нумерация блоков, отсев мусора, 404/403/истёкший срок, дубли,
   расстояние, контакт без выдумок, кеш, стабильность оценок). **Не проверено на живом интернете**: реальные ответы
   Arbeitsagentur и поисковиков, поведение с реальным ИИ — сделай один поиск Medium и посмотри лог и карточки.
8. **Идеи дальше**: прямые источники для Ausbildung (ausbildung.de, IHK-Lehrstellenbörse) без LLM, настоящий
   геокодер вместо таблицы городов, уведомления о новых вакансиях (сравнение с прошлым поиском).
