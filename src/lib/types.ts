// Общие типы приложения «Karriere Copilot»

export type Goal = 'job' | 'ausbildung' | 'chat';

export type SearchMode = 'easy' | 'medium' | 'max';

/**
 * Документ, приложенный к профилю (Lebenslauf, аттестат, сертификат...).
 * Текст извлекается на сервере, чтобы агент мог его прочитать и учитывать.
 */
export interface ProfileDocument {
  id: string;
  name: string; // имя файла
  mime: string;
  size: number; // байты
  chars: number; // сколько текста распознано
  text: string; // извлечённый текст (обрезан до лимита)
  addedAt: string;
}

/**
 * Профиль пользователя. Собирается поэтапной анкетой-регистрацией.
 * Почти все поля опциональны: если человек не определился с профессией,
 * агент смотрит на интересы, предметы, сильные стороны и сам подбирает направления.
 */
/** Одно своё поле: «название — значение» (например, «GitHub — github.com/…»). */
export interface CustomField {
  id: string;
  label: string;
  value: string;
}

/** Свой раздел профиля: заголовок + произвольные поля. */
export interface CustomSection {
  id: string;
  title: string;
  fields: CustomField[];
}

export interface UserProfile {
  goal: Goal;

  // Этап 1 — основное
  name?: string;
  age?: string;
  status?: string; // ещё в школе / закончил школу / студент / работаю / переезжаю

  // Этап 2 — образование и школа
  schoolCountry?: string; // Германия / другая страна
  schoolType?: string; // Hauptschule, Realschule, Gymnasium, Gesamtschule…
  graduation?: string; // Abitur, Fachabitur, Realschulabschluss, аттестат другой страны…
  gradeAverage?: string; // средний балл (шкала — любая, ИИ поймёт)
  bestSubjects?: string[]; // сильные / любимые предметы
  certificates?: string; // сертификаты, курсы, грамоты

  // Этап 3 — языки и документы
  germanLevel?: string;
  englishLevel?: string;
  otherLanguages?: string;
  workPermit?: string;

  // Этап 4 — направление
  decided?: boolean; // определился ли с профессией/должностью
  position?: string; // если определился
  interests?: string[]; // интересы (если не определился)
  workValues?: string[]; // что важно в работе
  strengths?: string; // сильные стороны
  likes?: string; // что нравилось в школе / на практике

  // Этап 5 — опыт и навыки
  experience?: string;
  skills?: string;
  drivingLicense?: string;

  // Только Ausbildung
  weakSubjects?: string[]; // предметы, которые давались тяжело (чтобы не предлагать профессии, где они главные)
  tryout?: string; // готовность начать с пробного дня / практики / EQ

  // Только поиск работы
  qualification?: string; // профессия / специальность по диплому или основной род занятий
  seniority?: string; // уровень позиции: Helfer / Fachkraft / Senior / руководитель
  germanyExperience?: string; // есть ли опыт работы в Германии
  avoid?: string; // чего точно не хочет (ночные смены, физтруд…)
  contract?: string; // какой тип договора подходит (unbefristet / befristet / Zeitarbeit)

  // Общие, но с разными вопросами в каждом режиме
  recognition?: string; // признание аттестата (Ausbildung) или диплома (работа), если учился не в Германии
  startDate?: string; // когда начать обучение / выйти на работу

  // Приложенные документы (Lebenslauf и другие) — читает агент
  documents?: ProfileDocument[];

  // Свои разделы и поля, которых нет в анкете (проекты, ссылки, хобби, особые условия…).
  // Агент читает их наравне с остальными ответами и запоминает.
  customSections?: CustomSection[];

  // Этап 6 — локация и условия
  city?: string;
  radius?: string; // «+10 км», «+25 км», «+50 км», «+100 км», «вся Германия»…
  relocation?: string; // готовность к переезду
  salary?: string;
  format?: string;
  extra?: string;

  // Заполняется агентом после глубокого анализа (не пользователем)
  aiAnalysis?: string;
  aiDirections?: string[];

  // Модель человека — структурная память агента (факты, выводы, журнал)
  personModel?: PersonModel;

  // Служебные поля анкеты-разговора
  wizardSkipped?: string[]; // id вопросов, которые пользователь явно пропустил
  analysisRounds?: number; // сколько кругов уточняющих вопросов уже было
}

/* ================= Модель человека (память агента) ================= */

/** Откуда агент узнал факт. */
export type FactSource = 'anketa' | 'document' | 'chat' | 'inference' | 'analysis';

/** Один факт в памяти агента. */
export interface MemoryFact {
  text: string;
  /** «Анкета», «Lebenslauf.pdf», «Ответ в чате», «Вывод ИИ», «Анализ анкеты» */
  source: string;
  /** 0–100 — насколько агент уверен в факте (без учёта времени) */
  confidence: number;
  /** ISO-время, когда факт попал в память */
  at: string;
  /** Политика полураспада: за сколько дней уверенность падает вдвое */
  halfLifeDays?: number;
  /** ISO-время последнего подтверждения факта человеком (сбрасывает распад) */
  confirmedAt?: string;
  /** ISO-время, когда факт забыт (есть только в архиве памяти) */
  forgottenAt?: string;
}

/** Секция модели человека — одна грань понимания. */
export interface MemorySection {
  id: string;
  title: string;
  facts: MemoryFact[];
  /** что в этой грани ещё непонятно */
  gaps: string[];
  /** 0–100 — насколько полно агент понимает эту грань */
  confidence: number;
}

/** Вывод ИИ с обоснованием (например, подбор направления, если человек не определился). */
export interface MemoryInference {
  text: string;
  basis: string;
}

/** Запись журнала памяти: что, когда и откуда агент запомнил. */
export interface JournalEntry {
  at: string;
  kind: 'learned' | 'inferred' | 'clarified' | 'forgotten' | 'reconfirmed' | 'transferred';
  text: string;
  source: string;
}

/**
 * Модель человека — то, что агент понял, запомнил и держит в голове.
 * Строится после отправки анкеты, обновляется от каждого ответа в чате
 * и используется во всех ответах агента и в поиске вакансий.
 */
export interface PersonModel {
  sections: MemorySection[];
  inferences: MemoryInference[];
  /** открытые вопросы — то, что агент ещё хочет уточнить */
  openQuestions: string[];
  /** 0–100 — общее понимание человека */
  overallConfidence: number;
  updatedAt: string;
  journal: JournalEntry[];
  /** Забытые по времени факты (восстановимые) — вне секций, в архиве памяти */
  archivedFacts?: MemoryFact[];
}

/* ================= Забывание по времени (полураспад доверия) ================= */

/** Состояние факта по «свежести» — эффективной уверенности с учётом распада. */
export type FactStatus = 'fresh' | 'aging' | 'stale' | 'forgotten';

export const FACT_STATUS_META: Record<
  FactStatus,
  { label: string; short: string }
> = {
  fresh: { label: 'свежий факт', short: 'свежий' },
  aging: { label: 'нормальная давность', short: 'давний' },
  stale: { label: 'могло устареть — стоит перепроверить', short: 'устаревает' },
  forgotten: { label: 'забыто по времени', short: 'забыто' },
};

/** Отчёт «уборки памяти»: что забыто и что размягчилось с последнего раза. */
export interface SweepReport {
  at: string;
  /** факты, отправленные в архив во время этой уборки */
  forgottenNow: { section: string; text: string }[];
  /** факты, которые пора перепроверить (уверенность упала из-за времени) */
  staleNow: string[];
  /** всего фактов в архиве после уборки */
  archivedTotal: number;
}

/** Служебная информация о долговременной памяти человека. */
export interface PersonMemoryMeta {
  sessionsCount: number;
  firstSeenAt: string | null;
  lastSyncAt: string | null;
  lastGoal: Goal | null;
}

/** Этап диалога с агентом. */
export type SessionStage = 'wizard' | 'analysis' | 'ready' | 'chat';

export const STAGE_LABELS: Record<SessionStage, string> = {
  wizard: 'Анкета',
  analysis: 'Знакомлюсь с тобой',
  ready: 'Готов к поиску',
  chat: 'Чат',
};

/** Итог проверки ссылки на вакансию. */
export type LinkState = 'ok' | 'closed' | 'unverified';

export interface LinkCheck {
  state: LinkState;
  /** Короткое пояснение для человека: что именно выяснилось. */
  note: string;
  httpStatus?: number;
  /** Адрес после редиректов (если отличается от исходного). */
  finalUrl?: string;
  /** Текст страницы удалось прочитать (данные ниже взяты со страницы, а не из поисковой выдачи). */
  pageRead: boolean;
  checkedAt: string;
}

/** Подробности вакансии. Все поля необязательны: если на странице не нашлось — null/пусто, не выдумываем. */
export interface VacancyDetails {
  /** Откуда данные: 'page' — со страницы вакансии, 'snippet' — только из поисковой выдачи. */
  source: 'page' | 'snippet';
  deadline?: string | null; // срок подачи заявки (Bewerbungsfrist)
  startDate?: string | null; // начало работы / обучения
  postedAt?: string | null; // дата публикации
  employmentType?: string | null; // Vollzeit / Teilzeit / Minijob / дуальная Ausbildung…
  duration?: string | null; // длительность Ausbildung
  salary?: string | null; // зарплата или Ausbildungsvergütung
  germanRequired?: string | null; // требуемый уровень немецкого, например «B1»
  education?: string | null; // требуемое образование / аттестат
  requirements: string[];
  tasks: string[];
  benefits: string[];
  howToApply?: string | null;
  contact?: string | null;
}

export type ApplyAdvice = 'apply' | 'maybe' | 'skip';

/** Персональная рекомендация: подходит ли вакансия именно этому человеку. */
export interface VacancyFit {
  advice: ApplyAdvice;
  label: string; // «Откликайся», «Откликайся, но учти пробелы», «Лучше пропустить»
  summary: string; // 1–2 предложения: почему такая рекомендация
  matches: string[]; // что совпадает с профилем
  gaps: string[]; // чего не хватает, но это поправимо
  blockers: string[]; // жёсткие несоответствия (язык, срок, право на работу…)
  actions: string[]; // что сделать перед откликом
  /** true — рекомендация построена по полному тексту страницы; false — только по краткой выдаче. */
  basedOnPage: boolean;
}

export interface VacancyIntel {
  link: LinkCheck;
  details?: VacancyDetails;
  fit?: VacancyFit;
}

export interface VacancyDTO {
  id: string;
  title: string;
  company?: string | null;
  location?: string | null;
  url: string;
  source?: string | null;
  salary?: string | null;
  description?: string | null;
  snippet?: string | null;
  score?: number | null;
  verdict?: string | null;
  reasons?: string[] | null;
  risks?: string[] | null;
  tags?: string[] | null;
  searchMode?: string | null;
  /** Проверка ссылки, подробности и рекомендация «подходит ли мне». У старых вакансий отсутствует. */
  intel?: VacancyIntel | null;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  vacancyIds?: string[];
  createdAt?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  goal: Goal;
  stage: SessionStage;
  updatedAt: string;
  profile?: UserProfile | null;
}

export type BackendProvider =
  | 'builtin'
  | 'ollama'
  | 'lmstudio'
  | 'groq'
  | 'openrouter'
  | 'custom';

export interface BackendConfig {
  provider: BackendProvider;
  // Для всех внешних провайдеров (OpenAI-совместимый API)
  customUrl?: string;
  customKey?: string;
  customModel?: string;
}

export const DEFAULT_BACKEND: BackendConfig = {
  provider: 'builtin',
};

export const PROVIDER_META: Record<
  BackendProvider,
  { label: string; url: string; model: string; needsKey: boolean; keyUrl?: string }
> = {
  builtin: { label: 'Встроенный ИИ', url: '', model: '', needsKey: false },
  ollama: {
    label: 'Ollama (локально)',
    url: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
  },
  lmstudio: {
    label: 'LM Studio (локально)',
    url: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
  },
  groq: {
    label: 'GroqCloud (облако)',
    url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter (облако)',
    url: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  custom: {
    label: 'Свой сервер (OpenAI-совместимый)',
    url: '',
    model: '',
    needsKey: false,
  },
};

export const GOAL_LABELS: Record<Goal, string> = {
  job: 'Поиск работы',
  ausbildung: 'Ausbildung',
  chat: 'Свободный чат',
};

export const MODE_META: Record<
  SearchMode,
  { label: string; desc: string; details: string; est: string }
> = {
  easy: {
    label: 'Легкий',
    desc: 'Быстрый поиск по главным порталам',
    details:
      '3 поисковых запроса, базовая выдача вакансий с главных джоб-бордов. Идеально для первого взгляда на рынок.',
    est: '~30 сек',
  },
  medium: {
    label: 'Средний',
    desc: 'Глубже: больше порталов + отбор ИИ',
    details:
      '6 запросов по разным порталам (Indeed, StepStone, Arbeitsagentur...), ИИ отбирает настоящие вакансии, чистит дубли и отмечает соответствие профилю.',
    est: '~1 мин',
  },
  max: {
    label: 'MAX',
    desc: 'Всё и везде: компании, анализ, ранжирование',
    details:
      '10–12 запросов по всем порталам + прямой поиск по компаниям тематки, чтение страниц вакансий, глубокий анализ соответствия твоего описания каждой вакансии: балл совместимости, сильные стороны, риски. Лучшие — сверху.',
    est: '~2–3 мин',
  },
};

// События SSE-потока от агента (поиск и чат)
export type AgentEvent =
  | { type: 'step'; key: string; label: string; status: 'active' | 'done' }
  | { type: 'log'; text: string }
  | { type: 'backend'; note: string }
  | { type: 'analysis'; text: string; directions?: string[] }
  | { type: 'memory'; model: PersonModel } // агент обновил память о человеке
  | { type: 'vacancies'; items: VacancyDTO[]; summary: string; mode: SearchMode }
  | { type: 'delta'; text: string }
  | { type: 'ready' } // агент всё понял и готов начать поиск
  | { type: 'done' }
  | { type: 'error'; message: string };

export function parseProfile(raw?: string | null): UserProfile | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function parseJsonArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
