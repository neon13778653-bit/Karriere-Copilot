// Поисковый конвейер агента: Легкий / Средний / MAX
// Генератор событий для SSE-ответа + сохранение результатов в БД.

import { db } from './db';
import { stripDecorativeEmojis } from './emoji';
import { deepAnalysisToMarkdown, runDeepAnalysis, type DeepAnalysisResult } from './analysis';
import { extractJson, llmComplete } from './llm';
import { cached, cacheKey, HOUR_MS, pruneCache } from './cache';
import { locationFit, parseRadiusKm } from './geo';
import {
  ageInDays,
  canonicalUrl,
  dedupeVacancies,
  diversify,
  preFilterHits,
  RELEVANCE_SCALE,
  REQUIREMENTS_SCALE,
  stableScore,
  type DropReason,
} from './search-quality';
import { buildBroadQueries, buildQueries, mergeQueries, queryCity, searchTerm } from './search-queries';
import { fetchBaDetails, searchArbeitsagentur, type BaJob } from './sources/arbeitsagentur';
import { inspectPage, searchMode, webSearch } from './web';
import { personModelToText } from './person-model';
import { profileToText } from './prompts';
import {
  assessLink,
  computeFit,
  detailsFromLd,
  focusText,
  normalizeDetails,
  parseIntel,
  type LdPosting,
  type LlmFit,
} from './vacancy-intel';
import type {
  AgentEvent,
  BackendConfig,
  Goal,
  LinkCheck,
  SearchMode,
  UserProfile,
  VacancyDetails,
  VacancyDTO,
  VacancyIntel,
} from './types';

interface RawHit {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
}

interface ExtractedVacancy {
  i?: number;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  url?: string;
  source?: string;
  snippet?: string;
  description?: string;
  score?: number;
  /** Ступень соответствия 0–4: по ней код считает воспроизводимую оценку (см. stableScore). */
  relevance?: number;
  verdict?: string;
  reasons?: string[];
  risks?: string[];
  tags?: string[];
  isVacancy?: boolean;
}

// analyze — у скольких лучших вакансий ИИ читает полный текст страницы и делает подробную рекомендацию.
// Ссылки проверяются у всех кандидатов во всех режимах (это не требует ИИ).
const MODE_CFG: Record<
  SearchMode,
  { queryCount: number; num: number; maxItems: number; maxVacancies: number; deep: boolean; analyze: number }
> = {
  easy: { queryCount: 3, num: 6, maxItems: 24, maxVacancies: 10, deep: false, analyze: 0 },
  medium: { queryCount: 6, num: 8, maxItems: 45, maxVacancies: 18, deep: false, analyze: 8 },
  max: { queryCount: 11, num: 10, maxItems: 80, maxVacancies: 30, deep: true, analyze: 99 },
};

/** Срок хранения результатов поиска в кеше. SEARCH_CACHE_HOURS=0 отключает кеш (по умолчанию 6 часов). */
function searchCacheTtlMs(): number {
  const raw = process.env.SEARCH_CACHE_HOURS;
  const h = raw === undefined || raw === '' ? 6 : Number(raw);
  return Number.isFinite(h) && h >= 0 ? h * HOUR_MS : 6 * HOUR_MS;
}

const DROP_LABEL: Record<DropReason, string> = {
  'blocked-domain': 'соцсети и форумы',
  listing: 'страницы-списки вакансий',
  info: 'статьи и справки',
  duplicate: 'повторы адресов',
  'bad-url': 'битые адреса',
};

/** Запас кандидатов: часть окажется неактуальной, список всё равно должен получиться полным. */
const CANDIDATE_SPARE = 6;

interface PageAnalysisItem {
  i?: number;
  score?: number;
  verdict?: string;
  description?: string;
  requirementsFit?: number;
  details?: unknown;
  fit?: LlmFit;
}

/** Выполняет fn для всех элементов не более чем в `limit` потоков; сбой одного элемента не ломает остальные. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch {
        // одна страница не должна останавливать проверку остальных
      }
    }
  });
  await Promise.all(workers);
}

function pageAnalysisPrompt(
  batch: { title: string; company?: string; location?: string; score?: number; pageText?: string }[],
  profile: UserProfile,
  goal: Goal,
): string {
  const isAus = goal === 'ausbildung';
  return [
    'Ты — карьерный аналитик по Германии. Для каждой вакансии ниже дан текст её страницы.',
    'Сделай ДВЕ вещи: (1) вытащи факты со страницы; (2) честно оцени, подходит ли вакансия ЭТОМУ человеку.',
    '',
    'ПРАВИЛА:',
    '— Факты бери ТОЛЬКО из текста страницы. Нет в тексте — null или []. Не выдумывай сроки, контакты, e-mail, телефоны, зарплату.',
    '— deadline и startDate — как написано на странице; germanRequired — уровень вроде «B1» или «B2», если указан, иначе null.',
    isAus
      ? '— Для Ausbildung особенно важны: duration (например, «3 года»), salary (Ausbildungsvergütung), education (минимальный аттестат), Berufsschule и начало обучения.'
      : '— Для работы особенно важны: employmentType (Vollzeit/Teilzeit/befristet/Zeitarbeit), salary, требуемый опыт, права/допуски, график.',
    '— requirements: до 6 коротких пунктов; tasks: до 5; benefits: до 5. contact — имя/e-mail/телефон ТОЧНО как на странице, иначе null.',
    '— fit.matches — что совпадает с профилем; fit.gaps — чего не хватает, но поправимо; fit.blockers — ТОЛЬКО жёсткое (язык, право на работу, обязательный аттестат/диплом, обязательные права/допуски, которых у человека явно нет); fit.actions — что сделать перед откликом (документы, курсы, вопросы работодателю).',
    '— fit.advice: apply (откликайся), maybe (откликайся, но есть пробелы) или skip (лучше пропустить). fit.summary — 1–2 предложения, обращайся к человеку на «ты».',
    `— requirementsFit: насколько человек выполняет требования вакансии (${REQUIREMENTS_SCALE}). score 0–100 по реальному содержимому страницы. НЕ используй эмодзи.`,
    '',
    'ПРОФИЛЬ:',
    profileToText(profile),
    profile.personModel
      ? `МОДЕЛЬ ЧЕЛОВЕКА (память агента: факты, выводы, ограничения):
${personModelToText(profile.personModel)}`
      : '',
    '',
    ...batch.map(
      (t, i) =>
        `${i + 1}. «${t.title}» (${t.company || '—'}, ${t.location || '—'}), текущая оценка ${t.score ?? '?'}/100
СТРАНИЦА: ${focusText(t.pageText || '', 3000)}`,
    ),
    '',
    'Ответь СТРОГО JSON:',
    '{"items":[{"i":1,"score":82,"requirementsFit":3,"verdict":"...","description":"2–3 предложения о сути вакансии","details":{"deadline":null,"startDate":null,"postedAt":null,"employmentType":null,"duration":null,"salary":null,"germanRequired":null,"education":null,"requirements":["..."],"tasks":["..."],"benefits":["..."],"howToApply":null,"contact":null},"fit":{"advice":"maybe","summary":"...","matches":["..."],"gaps":["..."],"blockers":[],"actions":["..."]}}]}',
  ].join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function stepEvt(key: string, label: string, status: 'active' | 'done'): AgentEvent {
  return { type: 'step', key, label, status };
}

/** Запускает полный поиск и отдаёт прогресс-события + финальные вакансии. */
export async function* runSearchPipeline(opts: {
  profile: UserProfile;
  goal: Goal;
  mode: SearchMode;
  sessionId: string;
  backend?: BackendConfig | null;
  /** Глубокий анализ, уже сделанный в этапе «понять человека» перед поиском. */
  savedAnalysis?: { portrait?: string; directions?: string[] } | null;
}): AsyncGenerator<AgentEvent> {
  const { profile, goal, mode, sessionId, backend, savedAnalysis } = opts;
  const cfg = MODE_CFG[mode];

  // ---------- ШАГ 0: глубокий анализ профиля — понять человека ----------
  yield stepEvt('understand', 'Внимательно и глубоко анализирую твою анкету', 'active');

  let analysis: DeepAnalysisResult;
  let emitAnalysis = true; // полный текст уже показывался в чате на этапе «готов начать поиск»?
  if (savedAnalysis?.directions?.length) {
    analysis = {
      portrait: savedAnalysis.portrait || '',
      directions: savedAnalysis.directions.map((name) => ({ name })),
      confidence: 100,
      understood: true,
    };
    emitAnalysis = false;
    yield {
      type: 'log',
      text: `Профиль уже глубоко проанализирован. Направления: ${savedAnalysis.directions.join(', ')}`,
    };
  } else {
    const { result, usedHeuristic } = await runDeepAnalysis(profile, goal, [], 0, backend);
    analysis = result;
    if (usedHeuristic) {
      yield { type: 'log', text: 'ИИ-анализ профиля не удался — собрал понимание по правилам (запасной режим).' };
    }
  }

  const directions = (analysis.directions || []).filter((d) => d.name).slice(0, 5);
  if (emitAnalysis) {
    yield {
      type: 'analysis',
      text: deepAnalysisToMarkdown(analysis, profile, { ending: 'searching' }),
      directions: directions.map((d) => d.name).filter((n): n is string => !!n),
    };
  }
  yield {
    type: 'log',
    text: `Понял профиль${typeof analysis.confidence === 'number' ? ` (уверенность ${Math.round(analysis.confidence)}%)` : ''}. Направления: ${directions.map((d) => d.name).join(', ')}`,
  };
  yield stepEvt('understand', 'Внимательно и глубоко анализирую твою анкету', 'done');

  // ---------- ШАГ 1: стратегия поиска по understood-профилю ----------
  yield stepEvt('analyze', 'Составляю стратегию поиска под твои направления', 'active');

  // Основа запросов строится кодом (стабильно и с нужными порталами), ИИ лишь добавляет варианты формулировок
  const terms = [
    ...new Set(
      [...directions.map((d) => searchTerm(d)), searchTerm({ name: profile.position })].filter(
        (t): t is string => !!t,
      ),
    ),
  ].slice(0, 5);
  const baseQueries = buildQueries({
    goal,
    terms,
    city: profile.city,
    germanLevel: profile.germanLevel,
    limit: Math.ceil(cfg.queryCount * 0.7),
  });
  const llmCount = Math.max(1, cfg.queryCount - baseQueries.length);

  const strategyPrompt = [
    'Ты — планировщик поисковых запросов для ИИ-агента по поиску ' +
      (goal === 'ausbildung' ? 'Ausbildung (учебных мест) в Германии' : 'работы в Германии') +
      '.',
    'Пользовательский профиль:',
    profileToText(profile),
    '',
    'ГЛУБОКИЙ АНАЛИЗ ПРОФИЛЯ (уже сделан — опирайся на него):',
    `Портрет: ${analysis.portrait || '—'}`,
    ...(directions.length
      ? [
          'Направления поиска:',
          ...directions.map((d, i) => `${i + 1}. ${d.name}${d.why ? ` — ${d.why}` : ''}${d.keywords?.length ? ` (ключевые фразы: ${d.keywords.slice(0, 3).join('; ')})` : ''}`),
        ]
      : []),
    ...(analysis.constraints?.length ? [`Ограничения: ${analysis.constraints.join('; ')}`] : []),
    '',
    'Составь поисковые запросы в стиле Google на НЕМЕЦКОМ языке (так находятся немецкие джоб-борды и сайты компаний).',
    `Ровно ${llmCount} запросов. Распредели их по направлениям выше (приоритет — направлению №1, но каждое значимое направление должно быть покрыто).`,
    baseQueries.length
      ? `Уже составлены такие запросы — НЕ повторяй их, предложи ДРУГИЕ формулировки, синонимы профессий и сайты работодателей: ${baseQueries.map((q) => `«${q}»`).join('; ')}`
      : '',
    goal === 'ausbildung'
      ? 'Ориентируйся на порталы: ausbildung.de, aubi-plus.de, ausbildungsportal.de, arbeitsagentur.de, шаги: "Ausbildung <профессия> <город>", "Ausbildungsstellen <город> 2026", "Ausbildung <профессия> <город> ausbildung.de" и т.п.'
      : 'Ориентируйся на порталы: indeed.com, stepstone.de, arbeitsagentur.de, linkedin.com, kimeta.de, jobware.de, meinestadt.de и сайты компаний напрямую: "Stellenangebote <профессия> <город>", "<профессия> Jobs <город> indeed", "Stellen <профессия> <город> stepstone".',
    profile.radius && profile.city
      ? `Учитывай радиус поиска «${profile.radius}»: arbeitsagentur.de отлично работает с радиусом — добавь запрос вида "<профессия> <город> Umkreis arbeitsagentur". Если радиус «Вся Германия» — не привязывай все запросы к городу.`
      : '',
    mode === 'max'
      ? 'Добавь запросы по компаниям: "Top Unternehmen <отрасль> <город>", "beste Arbeitgeber <отрасль> <город> Stellenangebote", а также варианты с remote/Teilzeit если это следует из профиля.'
      : '',
    'Учитывай язык профиля и уровень немецкого: если немецкий слабый (до B1), добавляй запросы вроде "English speaking jobs <город>" или "Vorbereitungsdienst/Praktikum".',
    '',
    'Ответь СТРОГО JSON без пояснений:',
    '{"queries":["..."],"roles":["..."],"cities":["..."]}',
  ]
    .filter(Boolean)
    .join('\n');

  let llmQueries: string[] = [];
  try {
    const res = await llmComplete(
      [
        { role: 'system', content: 'Ты возвращаешь только валидный JSON.' },
        { role: 'user', content: strategyPrompt },
      ],
      { backend, temperature: 0, maxTokens: 900 },
    );
    const parsed = extractJson<{ queries?: string[] }>(res.text);
    if (parsed?.queries?.length) {
      llmQueries = parsed.queries
        .filter((q) => typeof q === 'string' && q.trim().length > 3)
        .slice(0, llmCount);
    }
  } catch {
    // fallback ниже
  }
  let queries = mergeQueries(baseQueries, llmQueries, cfg.queryCount);
  if (!queries.length) {
    const pos = directions[0]?.name || profile.position || 'Jobs';
    const city = profile.city || 'Deutschland';
    const base =
      goal === 'ausbildung'
        ? `Ausbildung ${pos} ${city}`
        : `Stellenangebote ${pos} ${city}`;
    const extraDir = directions[1]?.name;
    queries = [
      base,
      `${base} indeed`,
      extraDir
        ? goal === 'ausbildung'
          ? `Ausbildung ${extraDir} ${city}`
          : `Stellenangebote ${extraDir} ${city}`
        : `${base} stepstone`,
    ].slice(0, cfg.queryCount);
  }
  yield {
    type: 'log',
    text: `Составил ${queries.length} поисковых запросов под твои направления` +
      (baseQueries.length ? ` (${Math.min(baseQueries.length, queries.length)} по шаблонам порталов и Arbeitsagentur, остальные — варианты от ИИ).` : '.'),
  };
  yield stepEvt('analyze', 'Составляю стратегию поиска под твои направления', 'done');

  // ---------- ШАГ 2: веб-поиск ----------
  yield stepEvt('search', 'Ищу вакансии на порталах и сайтах компаний', 'active');

  const cacheTtl = searchCacheTtlMs();
  if (Math.random() < 0.1) void pruneCache().catch(() => undefined); // изредка чистим старый кеш
  const rawHits: RawHit[] = [];
  const baByUrl = new Map<string, BaJob>();
  let cachedCalls = 0;

  // Официальная биржа Arbeitsagentur: самый надёжный источник — вакансия в её выдаче опубликована прямо сейчас
  const baTerms = terms.slice(0, mode === 'max' ? 3 : mode === 'medium' ? 2 : 1);
  if (baTerms.length) {
    const wo = queryCity(profile.city);
    const radius = parseRadiusKm(profile.radius);
    const umkreis = wo ? (radius != null && Number.isFinite(radius) ? radius : 50) : undefined;
    const baResults = await Promise.all(
      baTerms.map((was) =>
        cached(
          'ba',
          cacheKey('ba1', was, wo, umkreis, goal),
          cacheTtl,
          () => searchArbeitsagentur({ was, wo: wo || undefined, umkreis, goal, size: mode === 'easy' ? 15 : 25 }),
          (r) => r.jobs.length > 0,
        ),
      ),
    );
    for (let i = 0; i < baTerms.length; i++) {
      const { value, hit } = baResults[i];
      if (hit) cachedCalls++;
      yield {
        type: 'log',
        text: value.error
          ? `Arbeitsagentur «${baTerms[i]}» — недоступна (${value.error}), ищу через веб-поиск.`
          : `Arbeitsagentur «${baTerms[i]}» — ${value.jobs.length} вакансий.`,
      };
      for (const job of value.jobs) {
        const key = canonicalUrl(job.url);
        if (baByUrl.has(key)) continue;
        baByUrl.set(key, job);
        rawHits.push({
          url: job.url,
          name: job.employer ? `${job.title} — ${job.employer}` : job.title,
          snippet: [
            job.employer ? `Работодатель: ${job.employer}.` : '',
            job.location ? `Место: ${job.location}.` : '',
            job.startDate ? `Начало: ${job.startDate}.` : '',
            job.postedAt ? `Опубликовано: ${job.postedAt}.` : '',
            job.profession ? `Профессия: ${job.profession}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
          host_name: 'arbeitsagentur.de',
          rank: rawHits.length + 1,
        });
      }
    }
  }

  const searchWeb = async (q: string) => {
    const r = await cached('web', cacheKey('web1', q, cfg.num), cacheTtl, () => webSearch(q, cfg.num), (v) => v.length > 0);
    if (r.hit) cachedCalls++;
    return r.value;
  };

  for (let i = 0; i < queries.length; i += 3) {
    const batch = queries.slice(i, i + 3);
    const results = await Promise.all(batch.map((q) => searchWeb(q)));
    for (let j = 0; j < batch.length; j++) {
      const found = results[j] || [];
      yield { type: 'log', text: `«${batch[j]}» — ${found.length} результатов` };
      rawHits.push(...found);
    }
  }

  // чистим мусор ДО ИИ: соцсети, списки «1 234 вакансии…», статьи про зарплату, повторы адресов
  let filtered = preFilterHits(rawHits, { minKeep: 10 });
  if (filtered.kept.length < Math.max(10, cfg.maxVacancies) && terms.length) {
    const broad = buildBroadQueries(goal, terms);
    const extra = await Promise.all(broad.map((q) => searchWeb(q)));
    for (let j = 0; j < broad.length; j++) {
      yield { type: 'log', text: `Мало подходящих ссылок — расширяю поиск: «${broad[j]}» — ${extra[j].length} результатов` };
      rawHits.push(...extra[j]);
    }
    filtered = preFilterHits(rawHits, { minKeep: 10 });
  }
  const dropCounts = new Map<DropReason, number>();
  for (const d of filtered.dropped) dropCounts.set(d.reason, (dropCounts.get(d.reason) ?? 0) + 1);
  const dropText = [...dropCounts.entries()].map(([r, n]) => `${DROP_LABEL[r]} — ${n}`).join(', ');
  const trustByUrl = new Map(filtered.kept.map((k) => [k.hit.url, k.trust]));
  const limited: RawHit[] = filtered.kept.slice(0, cfg.maxItems).map((k) => k.hit);
  yield {
    type: 'log',
    text:
      `Собрано ${rawHits.length} ссылок. ` +
      (dropText ? `Отсеял до анализа: ${dropText}. ` : '') +
      `На разбор иду с ${limited.length}.` +
      (cachedCalls ? ` Из кеша взято запросов: ${cachedCalls}.` : ''),
  };
  yield stepEvt('search', 'Ищу вакансии на порталах и сайтах компаний', 'done');

  if (!limited.length) {
    yield {
      type: 'error',
      message:
        searchMode() === 'none'
          ? 'Веб-поиск не настроен на этом компьютере, поэтому искать вакансии нечем. Задай SEARXNG_URL (свой SearXNG) или BRAVE_API_KEY в файле .env и перезапусти приложение — инструкция в README.'
          : 'Не нашёл ни одной ссылки по этим запросам. Попробуй уточнить профессию или город в профиле и запустить поиск ещё раз.',
    };
    return;
  }

  // ---------- ШАГ 3: отбор и анализ ----------
  yield stepEvt(
    'extract',
    cfg.deep
      ? 'Изучаю найденное и сравниваю каждую вакансию с твоим профилем'
      : 'Изучаю найденное и отбираю настоящие вакансии',
    'active',
  );

  const profileKey = profileToText(profile) + (profile.personModel ? personModelToText(profile.personModel) : '');
  const extractionPrompt = (items: RawHit[]) =>
    [
      'Ты — аналитик вакансий в Германии. Ниже — результаты веб-поиска (заголовок, ссылка, источник, сниппет).',
      'Задача: отобрать РЕАЛЬНЫЕ вакансии' +
        (goal === 'ausbildung' ? ' (учебные места Ausbildung)' : ' (рабочие места)') +
        ' и заполнить по каждой поля.',
      '',
      'ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (для оценки соответствия):',
      profileToText(profile),
      profile.personModel
        ? `МОДЕЛЬ ЧЕЛОВЕКА (структурированная память об этом человеке: факты, выводы ИИ, пробелы — опирайся на неё при оценке соответствия):\n${personModelToText(profile.personModel)}`
        : '',
      '',
      `Главное поле — relevance: ступень соответствия профессии/направлению человека (${RELEVANCE_SCALE}). Ставь её по сути вакансии, а не по красоте объявления; не выдумывай, если данных мало, — выбирай осторожную ступень.`,
      cfg.deep
        ? 'Для каждой вакансии оцени СООТВЕТСТВИЕ профилю: relevance (0–4), score 0–100 (по языку, городу, опыту, навыкам, праву на работу), verdict (1 фраза), reasons (2–4 сильных стороны совпадения), risks (0–3 риска/несоответствия), tags (2–4 тега: город, язык, формат, отрасль).'
        : 'Для каждой вакансии поставь relevance (0–4), быстрый score 0–100 и 1–2 тега.',
      'Отбрасывай: статьи, списки «топ профессий», форумы, агрегаторы без конкретной вакансии, образовательные курсы (если это не Ausbildung-поиск), страницы «об нас».',
      'Пиши строго и по делу: НЕ используй эмодзи ни в одном поле ответа.',
      'Если в сниппете нет зарплаты — не выдумывай её, оставь null.',
      `Верни максимум ${cfg.maxVacancies} лучших вакансий.`,
      '',
      'РЕЗУЛЬТАТЫ ПОИСКА:',
      ...items.map(
        (h, i) => `${i + 1}. ${h.name}\n   URL: ${h.url}\n   Источник: ${h.host_name}\n   Сниппет: ${h.snippet}`,
      ),
      '',
      'Ответь СТРОГО JSON:',
      '{"vacancies":[{"i":1,"title":"...","company":"...","location":"...","salary":null,"snippet":"кратко о вакансии","relevance":3,"score":75,"verdict":"...","reasons":["..."],"risks":["..."],"tags":["..."]}]}',
      'В поле i — номер из списка выше. company/location попробуй извлечь из заголовка или сниппета, если не видно — null.',
    ].join('\n');

  let extracted: ExtractedVacancy[] = [];
  const CHUNK = 25;
  for (let i = 0; i < limited.length; i += CHUNK) {
    const chunk = limited.slice(i, i + CHUNK);
    try {
      // temperature 0 + кеш по входным данным: тот же профиль и те же ссылки дают тот же разбор
      const key = cacheKey('extract2', goal, cfg.deep, cfg.maxVacancies, profileKey, chunk.map((h) => [h.url, h.name, h.snippet]));
      const { value: list, hit } = await cached(
        'extract',
        key,
        cacheTtl * 4,
        async () => {
          const res = await llmComplete(
            [
              { role: 'system', content: 'Ты возвращаешь только валидный JSON.' },
              { role: 'user', content: extractionPrompt(chunk) },
            ],
            { backend, temperature: 0, maxTokens: 3000 },
          );
          return extractJson<{ vacancies?: ExtractedVacancy[] }>(res.text)?.vacancies ?? [];
        },
        (v) => v.length > 0,
      );
      // номер i ИИ считает внутри блока (1..25) — приводим к номеру во всём списке, иначе данные
      // вакансий из второго и следующих блоков прилипали бы к ссылкам первого блока
      extracted.push(...list.map((v) => ({ ...v, i: (v.i || 0) + i })));
      yield { type: 'log', text: `Проанализировал блок ${Math.floor(i / CHUNK) + 1} результатов${hit ? ' (из кеша)' : ''}.` };
    } catch {
      yield { type: 'log', text: 'Блок результатов не распознан, пропускаю.' };
    }
  }

  // маппим обратно на ссылки
  type Merged = Omit<ExtractedVacancy, 'title' | 'url'> & {
    title: string;
    url: string;
    hit: RawHit;
    trust: number;
    ba?: BaJob;
  };
  const mergedRaw: Merged[] = [];
  const usedUrls = new Set<string>();
  for (const v of extracted) {
    const hit = limited[(v.i || 0) - 1];
    if (!hit) continue;
    const urlKey = canonicalUrl(hit.url);
    if (usedUrls.has(urlKey)) continue;
    usedUrls.add(urlKey);
    const ba = baByUrl.get(urlKey);
    // данные официальной биржи надёжнее разбора ИИ — перекрываем ими
    const title = ba?.title ?? (v.title?.trim() || hit.name);
    if (!title || title.length < 3) continue;
    mergedRaw.push({
      ...v,
      title,
      company: ba?.employer ?? v.company,
      location: ba?.location ?? v.location,
      url: hit.url,
      source: v.source || hit.host_name,
      hit,
      trust: trustByUrl.get(hit.url) ?? 0.5,
      ba,
    });
  }
  extracted = [];
  // одна вакансия на нескольких порталах → одна запись (остаётся самый надёжный источник)
  const dd = dedupeVacancies(mergedRaw);
  const merged = dd.kept;
  if (dd.removed) yield { type: 'log', text: `Склеил ${dd.removed} дублей: одна и та же вакансия с разных порталов.` };
  if (!merged.length) {
    yield {
      type: 'error',
      message:
        'По этим запросам не удалось выделить конкретные вакансии. Попробуй другой режим или уточни профессию.',
    };
    return;
  }
  yield stepEvt(
    'extract',
    cfg.deep ? 'Сравниваю каждую вакансию с твоим профилем' : 'Изучаю найденное и отбираю настоящие вакансии',
    'done',
  );

  // ---------- ШАГ 4: проверяем, что ссылки открываются и вакансии актуальны ----------
  type Cand = Merged & {
    link?: LinkCheck;
    ld?: LdPosting | null;
    pageText?: string;
    details?: VacancyDetails;
    llmFit?: LlmFit;
    requirementsFit?: number;
    analyzed?: boolean;
  };
  const prelim = (c: Merged) => stableScore({ relevance: c.relevance, trust: c.trust, llmScore: c.score }) ?? c.score ?? 0;
  const candidates: Cand[] = [...merged]
    .sort((a, b) => prelim(b) - prelim(a))
    .slice(0, cfg.maxVacancies + CANDIDATE_SPARE);

  yield stepEvt('verify', 'Проверяю, что ссылки открываются и вакансии актуальны', 'active');
  await mapLimit(candidates, 6, async (c) => {
    if (c.ba) {
      // Официальная биржа: вакансия есть в актуальной выдаче. Страница вакансии у неё строится JavaScript-ом,
      // поэтому текст берём из API деталей, а не открываем страницу.
      const ba = c.ba;
      const { value: text } = await cached('badetail', cacheKey('bad1', ba.refnr), cacheTtl * 4, () => fetchBaDetails(ba.refnr), (v) => !!v);
      c.link = {
        state: 'ok',
        note: 'Официальная биржа Arbeitsagentur: вакансия есть в актуальной выдаче на момент поиска.',
        pageRead: !!text && text.length > 300,
        checkedAt: new Date().toISOString(),
      };
      c.ld = { title: ba.title, company: ba.employer, location: ba.location, postedAt: ba.postedAt?.slice(0, 10), startDate: ba.startDate };
      if (text) c.pageText = text;
      return;
    }
    const ins = await inspectPage(c.url, { timeoutMs: 10_000 });
    const { link, ld } = assessLink(c.url, ins);
    c.link = link;
    c.ld = ld;
    if (ins.reachable && ins.text) c.pageText = ins.text; // html дальше не нужен — не держим в памяти
  });
  for (const c of candidates) {
    c.link ??= {
      state: 'unverified',
      note: 'Не удалось проверить автоматически — открой ссылку сам.',
      pageRead: false,
      checkedAt: new Date().toISOString(),
    };
  }
  const closed = candidates.filter((c) => c.link?.state === 'closed');
  const alive = candidates.filter((c) => c.link?.state !== 'closed');
  const okCount = alive.filter((c) => c.link?.state === 'ok').length;
  yield {
    type: 'log',
    text:
      `Проверил ссылки: открываются и актуальны — ${okCount}, не удалось проверить автоматически — ${alive.length - okCount}` +
      (closed.length ? `, неактуальных исключил — ${closed.length}.` : '.'),
  };
  yield stepEvt('verify', 'Проверяю, что ссылки открываются и вакансии актуальны', 'done');
  if (!alive.length) {
    yield {
      type: 'error',
      message: `Все найденные вакансии (${closed.length}) оказались неактуальными: страницы удалены или срок подачи истёк. Попробуй запустить поиск позже или в другом режиме.`,
    };
    return;
  }

  // ---------- ШАГ 5: читаем страницы и оцениваем, подходит ли каждая вакансия именно тебе ----------
  yield stepEvt('fit', 'Читаю вакансии и оцениваю, подходят ли они именно тебе', 'active');
  for (const c of alive) {
    if (c.ld) c.details = detailsFromLd(c.ld, 'page');
  }
  const readable = alive
    .filter((c) => c.link?.pageRead && (c.pageText?.length ?? 0) > 300)
    .slice(0, cfg.analyze);
  if (readable.length) {
    const BATCH = 3;
    for (let i = 0; i < readable.length; i += BATCH) {
      const batch = readable.slice(i, i + BATCH);
      try {
        const key = cacheKey('page2', goal, profileKey, batch.map((c) => [c.url, (c.pageText ?? '').length, (c.pageText ?? '').slice(0, 400)]));
        const { value: items } = await cached(
          'page',
          key,
          cacheTtl * 4,
          async () => {
            const res = await llmComplete(
              [
                { role: 'system', content: 'Ты возвращаешь только валидный JSON.' },
                { role: 'user', content: pageAnalysisPrompt(batch, profile, goal) },
              ],
              { backend, temperature: 0, maxTokens: 3200 },
            );
            return extractJson<{ items?: PageAnalysisItem[] }>(res.text)?.items ?? [];
          },
          (v) => v.length > 0,
        );
        for (const it of items) {
          const target = batch[(it.i || 0) - 1];
          if (!target) continue;
          if (typeof it.score === 'number') target.score = Math.max(0, Math.min(100, Math.round(it.score)));
          if (typeof it.requirementsFit === 'number') target.requirementsFit = it.requirementsFit;
          if (it.verdict) target.verdict = it.verdict;
          if (it.description) target.description = it.description;
          target.details = normalizeDetails(it.details, {
            source: 'page',
            ld: target.ld,
            pageText: target.pageText,
          });
          target.llmFit = it.fit;
          target.analyzed = true;
        }
        yield {
          type: 'log',
          text: `Прочитал и сравнил с твоим профилем вакансии ${i + 1}–${Math.min(i + BATCH, readable.length)} из ${readable.length}.`,
        };
      } catch {
        yield { type: 'log', text: 'Часть вакансий не удалось разобрать по странице — оставляю краткую оценку.' };
      }
    }
  }

  // рекомендация «подходит ли мне»: жёсткие правила + мнение ИИ
  const intelById = new Map<Cand, VacancyIntel>();
  for (const c of alive) {
    const link = c.link!;
    // оценку считает код по ступеням ИИ + расстоянию, возрасту и источнику — она воспроизводима
    const loc = locationFit(profile, {
      text: c.location ?? c.ba?.location ?? '',
      lat: c.ba?.lat,
      lon: c.ba?.lon,
      distanceKm: c.ba?.distanceKm,
    });
    const stable = stableScore({
      relevance: c.relevance,
      requirementsFit: c.requirementsFit,
      locationDelta: loc.delta,
      trust: c.trust,
      ageDays: ageInDays(c.details?.postedAt ?? c.ld?.postedAt),
      llmScore: c.score,
    });
    if (stable != null) c.score = stable;
    const { fit, scoreCap } = computeFit({
      profile,
      goal,
      link,
      location: loc,
      details: c.details,
      llm: c.analyzed
        ? c.llmFit
        : { matches: c.reasons, gaps: c.risks, summary: undefined },
      score: c.score,
      pageAnalyzed: !!c.analyzed,
    });
    if (scoreCap != null && typeof c.score === 'number') c.score = Math.min(c.score, scoreCap);
    // списки «почему подходит / на что обратить внимание» держим согласованными с рекомендацией
    if (fit.matches.length) c.reasons = fit.matches;
    const issues = [...fit.blockers, ...fit.gaps];
    if (issues.length) c.risks = issues;
    if (fit.blockers.length) c.verdict = `Есть жёсткое несоответствие: ${fit.blockers[0]}`;
    if (c.details && !c.salary && c.details.salary) c.salary = c.details.salary;
    intelById.set(c, { link, details: c.details, fit });
  }
  yield stepEvt('fit', 'Читаю вакансии и оцениваю, подходят ли они именно тебе', 'done');

  // ---------- ШАГ 6: ранжирование и сохранение ----------
  yield stepEvt('rank', 'Ранжирую вакансии: лучшие сверху', 'active');
  alive.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.trust - a.trust);
  const finalList = diversify(alive, 3).slice(0, cfg.maxVacancies); // не больше 3 вакансий от одной компании

  const rowsData = finalList.map((v) => ({
    sessionId,
    title: stripDecorativeEmojis(v.title).slice(0, 300),
    company: v.company ? stripDecorativeEmojis(v.company).slice(0, 200) || null : null,
    location: v.location ? stripDecorativeEmojis(v.location).slice(0, 200) || null : null,
    url: v.url,
    source: v.source || v.hit?.host_name || null,
    salary: v.salary ? stripDecorativeEmojis(v.salary).slice(0, 200) || null : null,
    description: v.description ? stripDecorativeEmojis(v.description).slice(0, 2500) || null : null,
    snippet: (v.snippet || v.hit?.snippet || '').slice(0, 1200) || null,
    score: typeof v.score === 'number' ? Math.max(0, Math.min(100, Math.round(v.score))) : null,
    verdict: v.verdict ? stripDecorativeEmojis(v.verdict).slice(0, 300) || null : null,
    reasons: v.reasons?.length ? JSON.stringify(v.reasons.slice(0, 5).map(stripDecorativeEmojis)) : null,
    risks: v.risks?.length ? JSON.stringify(v.risks.slice(0, 4).map(stripDecorativeEmojis)) : null,
    tags: v.tags?.length ? JSON.stringify(v.tags.slice(0, 5).map(stripDecorativeEmojis)) : null,
    searchMode: mode,
    intel: JSON.stringify(intelById.get(v) ?? null),
  }));
  const saved = await db.vacancy.createMany({ data: rowsData });

  const rows = await db.vacancy.findMany({
    where: { sessionId },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
  });
  const items: VacancyDTO[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location,
    url: r.url,
    source: r.source,
    salary: r.salary,
    description: r.description,
    snippet: r.snippet,
    score: r.score,
    verdict: r.verdict,
    reasons: r.reasons ? safeArr(r.reasons) : null,
    risks: r.risks ? safeArr(r.risks) : null,
    tags: r.tags ? safeArr(r.tags) : null,
    searchMode: r.searchMode,
    // поле intel появляется после `prisma generate`; у вакансий старых поисков его нет
    intel: parseIntel((r as { intel?: string | null }).intel),
  }));
  yield stepEvt('rank', 'Ранжирую вакансии: лучшие сверху', 'done');
  yield { type: 'log', text: `Сохранено ${saved.count} вакансий в этой сессии.` };

  const top = items[0];
  const summary =
    mode === 'max'
      ? `Готово! MAX-поиск завершён: проверил порталы и компании, прочитал страницы вакансий и сравнил каждую с твоим профилем. Всего отобрал **${items.length}** вакансий${top ? `, самая подходящая — «${top.title}» (${top.score ?? '?'}/100)` : ''}. Список отсортирован по моему мнению о совместимости: лучшие сверху. Кликни карточку, чтобы раскрыть детали, и спрашивай в чате про любую.`
      : mode === 'medium'
        ? `Готово! Средний поиск завершён: ${items.length} отобранных ИИ вакансий без дублей${top ? `, лучшее совпадение — «${top.title}» (${top.score ?? '?'}/100)` : ''}. Карточки отсортированы по соответствию твоему профилю — спрашивай в чате про любую.`
        : `Быстрый поиск завершён: ${items.length} вакансий с главных порталов${top ? `, сверху — «${top.title}»` : ''}. Для глубокого анализа компаний и точного ранжирования попробуй режим MAX. Спрашивай в чате про любую вакансию.`;

  const okFinal = finalList.filter((c) => c.link?.state === 'ok').length;
  const checkNote =
    ` Ссылки проверены: ${okFinal} из ${finalList.length} открываются и актуальны` +
    (closed.length ? `, ${closed.length} неактуальных я исключил` : '') +
    '. У каждой вакансии есть рекомендация, подходит ли она тебе, и что сделать перед откликом.';

  yield { type: 'vacancies', items, summary: summary + checkNote, mode };
}

function safeArr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
