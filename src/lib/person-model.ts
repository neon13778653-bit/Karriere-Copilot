// Модель человека — структурная память агента.
//
// Три уровня памяти:
//  1) сырые данные        — анкета UserProfile + тексты документов (Lebenslauf…)
//  2) модель человека     — PersonModel: факты по секциям, выводы ИИ, пробелы, % понимания
//  3) журнал памяти       — что, когда и откуда агент запомнил
//
// Конвейер: buildBasePersonModel (детерминированное извлечение) → обогащение от
// глубокого анализа ИИ (applyAnalysisMemory) → обновление от каждого ответа в чате
// (mergeChatAnswer) → использование в промптах чата и поиска (personModelToText).

import type {
  Goal,
  JournalEntry,
  MemoryFact,
  MemoryInference,
  MemorySection,
  PersonModel,
  UserProfile,
} from './types';
import { customFieldLines } from './custom-sections';
import {
  HALF_LIFE_BY_SECTION,
  factEffective,
  factStatusOf,
  recomputeDecayAware,
} from './memory-decay';

/* ============================ Секции модели ============================ */

export const SECTION_DEFS: { id: string; title: string; hint: string }[] = [
  { id: 'identity', title: 'Кто ты и на каком ты этапе', hint: 'имя, возраст, чем сейчас занят' },
  { id: 'education', title: 'Образование и школа', hint: 'какая школа, аттестат, средний балл, предметы, сертификаты' },
  { id: 'languages', title: 'Языки', hint: 'немецкий, английский, другие' },
  { id: 'documents', title: 'Документы и право на работу', hint: 'виза, разрешение, статус' },
  { id: 'direction', title: 'Направление и цель', hint: 'профессия или подобранные направления' },
  { id: 'experience', title: 'Опыт и навыки', hint: 'практика, работа, умения, права' },
  { id: 'location', title: 'Где искать и мобильность', hint: 'город/регион, радиус, переезд' },
  { id: 'conditions', title: 'Условия и ожидания', hint: 'доход, формат, что важно в работе' },
  { id: 'constraints', title: 'Ограничения и риски', hint: 'язык, документы, оценки, дистанция' },
  { id: 'motivation', title: 'Мотивация и характер', hint: 'что нравится, сильные стороны, ценности, свои разделы профиля' },
];

const SECTION_BY_ID = new Map(SECTION_DEFS.map((s) => [s.id, s]));

function nowIso(): string {
  return new Date().toISOString();
}

function clampConf(n: unknown, fallback = 90): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function fact(text: string, source: string, confidence = 95): MemoryFact {
  return { text, source, confidence, at: nowIso() };
}

/* ================== 1) Базовое извлечение (без ИИ) ================== */

/**
 * Детерминированное извлечение фактов из анкеты и документов.
 * Работает всегда, даже если ИИ-сервер недоступен — поэтому память
 * не бывает пустой. Каждый факт помечен источником.
 */
export function buildBasePersonModel(profile: UserProfile, goal: Goal): PersonModel {
  const isAusbildung = goal === 'ausbildung';
  const sections = new Map<string, MemorySection>();
  const journal: JournalEntry[] = [];

  const add = (id: string, f: MemoryFact) => {
    const def = SECTION_BY_ID.get(id);
    if (!def || !f.text?.trim()) return;
    f.halfLifeDays = HALF_LIFE_BY_SECTION[id] ?? 180; // политика забывания по времени
    let sec = sections.get(id);
    if (!sec) {
      sec = { id, title: def.title, facts: [], gaps: [], confidence: 0 };
      sections.set(id, sec);
    }
    sec.facts.push(f);
  };
  const log = (kind: JournalEntry['kind'], text: string, source: string) => {
    journal.push({ at: nowIso(), kind, text, source });
  };

  // — Кто ты
  const identity: string[] = [];
  if (profile.name) identity.push(profile.name);
  if (profile.age) identity.push(`${profile.age} лет`);
  if (profile.status) identity.push(profile.status.toLowerCase());
  if (identity.length) {
    const f = fact(identity.join(', '), 'Анкета');
    add('identity', f);
    log('learned', `Этап жизни: ${f.text}`, 'Анкета');
  }

  // — Образование и школа
  const edu: string[] = [];
  if (profile.schoolCountry) edu.push(`учился(ась) в ${profile.schoolCountry}`);
  if (profile.schoolType) edu.push(`тип заведения: ${profile.schoolType}`);
  if (profile.graduation) edu.push(`аттестат/диплом: ${profile.graduation}`);
  if (edu.length) {
    const f = fact(edu.join('; '), 'Анкета');
    add('education', f);
    log('learned', f.text, 'Анкета');
  }
  if (profile.gradeAverage) {
    add('education', fact(`Средний балл: ${profile.gradeAverage}`, 'Анкета'));
  }
  if (profile.bestSubjects?.length) {
    add('education', fact(`Сильные/любимые предметы: ${profile.bestSubjects.join(', ')}`, 'Анкета'));
  }
  if (profile.weakSubjects?.length) {
    add('education', fact(`Тяжёлые предметы: ${profile.weakSubjects.join(', ')}`, 'Анкета'));
  }
  if (profile.qualification) {
    add('education', fact(`Профессия/специальность: ${profile.qualification}`, 'Анкета'));
  }
  if (profile.recognition) {
    add(
      'education',
      fact(`Признание ${isAusbildung ? 'аттестата' : 'диплома'} в Германии: ${profile.recognition}`, 'Анкета'),
    );
  }
  if (profile.certificates) {
    add(
      'education',
      fact(`${isAusbildung ? 'Сертификаты и курсы' : 'Сертификаты и допуски'}: ${profile.certificates}`, 'Анкета'),
    );
  }

  // — Языки
  if (profile.germanLevel) {
    add('languages', fact(`Немецкий: ${profile.germanLevel}`, 'Анкета'));
    log('learned', `Уровень немецкого: ${profile.germanLevel}`, 'Анкета');
  }
  if (profile.englishLevel) add('languages', fact(`Английский: ${profile.englishLevel}`, 'Анкета'));
  if (profile.otherLanguages) add('languages', fact(`Другие языки: ${profile.otherLanguages}`, 'Анкета'));

  // — Документы и право на работу
  if (profile.workPermit) {
    const permitLabel = isAusbildung ? 'Статус проживания' : 'Право на работу';
    add('documents', fact(`${permitLabel}: ${profile.workPermit}`, 'Анкета'));
    log('learned', `${permitLabel}: ${profile.workPermit}`, 'Анкета');
  }

  // — Направление
  if (profile.decided === false) {
    add('direction', fact('Профессию пока НЕ выбрал(а) — ждёт подбора направлений по остальным данным', 'Анкета'));
  } else if (profile.position) {
    add('direction', fact(`Цель: ${profile.position}`, 'Анкета'));
    log('learned', `Желаемая цель: ${profile.position}`, 'Анкета');
  }
  if (profile.interests?.length) {
    add('direction', fact(`Интересы: ${profile.interests.join(', ')}`, 'Анкета'));
    log('learned', `Интересы: ${profile.interests.join(', ')}`, 'Анкета');
  }
  if (profile.seniority) add('direction', fact(`Уровень позиции: ${profile.seniority}`, 'Анкета'));

  // — Опыт и навыки
  if (profile.experience)
    add('experience', fact(`${isAusbildung ? 'Практика и подработки' : 'Опыт работы'}: ${profile.experience}`, 'Анкета'));
  if (profile.germanyExperience)
    add('experience', fact(`Опыт работы в Германии: ${profile.germanyExperience}`, 'Анкета'));
  if (profile.tryout) add('experience', fact(`Пробный день / практика / EQ: ${profile.tryout}`, 'Анкета'));
  if (profile.skills) add('experience', fact(`Навыки: ${profile.skills}`, 'Анкета'));
  if (profile.drivingLicense) add('experience', fact(`Водительские права: ${profile.drivingLicense}`, 'Анкета'));

  // — Локация
  if (profile.city) {
    const loc = `Ищет ${isAusbildung ? 'учебное место' : 'работу'} в районе: ${profile.city}${profile.radius ? ` (радиус ${profile.radius})` : ''}`;
    add('location', fact(loc, 'Анкета'));
    log('learned', loc, 'Анкета');
  }
  if (profile.relocation) add('location', fact(`Переезд: ${profile.relocation}`, 'Анкета'));

  // — Условия
  if (profile.salary)
    add('conditions', fact(`${isAusbildung ? 'Ожидания по Ausbildungsvergütung' : 'Ожидания по доходу'}: ${profile.salary}`, 'Анкета'));
  if (profile.format)
    add('conditions', fact(`${isAusbildung ? 'Вид обучения' : 'Формат работы'}: ${profile.format}`, 'Анкета'));
  if (profile.startDate)
    add('conditions', fact(`${isAusbildung ? 'Начало обучения' : 'Готов выйти на работу'}: ${profile.startDate}`, 'Анкета'));
  if (profile.contract) add('conditions', fact(`Тип договора: ${profile.contract}`, 'Анкета'));
  if (profile.avoid) add('conditions', fact(`Чего не хочет: ${profile.avoid}`, 'Анкета'));
  if (profile.workValues?.length)
    add('conditions', fact(`${isAusbildung ? 'Важно в учёбе' : 'Важно в работе'}: ${profile.workValues.join(', ')}`, 'Анкета'));

  // — Мотивация
  if (profile.strengths) add('motivation', fact(`Сильные стороны: ${profile.strengths}`, 'Анкета'));
  if (profile.likes) add('motivation', fact(`Что нравилось: ${profile.likes}`, 'Анкета'));
  if (profile.extra) add('motivation', fact(`Дополнительно: ${profile.extra}`, 'Анкета'));

  // — Свои разделы и поля, добавленные человеком в профиль
  for (const line of customFieldLines(profile.customSections)) {
    add('motivation', fact(line, 'Анкета'));
  }

  // — Документы: агент их прочитал и вынес в память
  if (profile.documents?.length) {
    for (const d of profile.documents) {
      const f = fact(
        `Прочитал(а) файл «${d.name}» (${d.chars > 0 ? `${Math.round(d.chars / 100) / 10} тыс. символов текста` : 'текст не распознан'}) — данные из него учтены`,
        `Файл: ${d.name}`,
        d.chars > 0 ? 85 : 40,
      );
      add('experience', f);
      log('learned', `Изучил документ «${d.name}» и включил его данные в профиль`, `Файл: ${d.name}`);
    }
  }

  // — Пропуски анкеты тоже запоминаем (честная память)
  if (profile.wizardSkipped?.length) {
    add('identity', fact(`В анкете пропустил(а) вопросов: ${profile.wizardSkipped.length}`, 'Анкета', 100));
  }

  const model: PersonModel = {
    sections: SECTION_DEFS.map((def) => {
      const sec = sections.get(def.id);
      return (
        sec ?? { id: def.id, title: def.title, facts: [], gaps: [], confidence: 0 }
      );
    }),
    inferences: [],
    openQuestions: [],
    overallConfidence: 0,
    updatedAt: nowIso(),
    journal,
  };

  recomputeConfidence(model, profile);
  return model;
}

/**
 * Обновляет в готовой модели только то, что пришло из профиля («Анкета» и «Файл: …»),
 * когда человек поправил ответы без повторного анализа. Выводы ИИ, ответы из чата и открытые
 * вопросы остаются как были; неизменившиеся факты сохраняют время и подтверждение.
 */
export function refreshAnketaFacts(
  existing: PersonModel | null | undefined,
  profile: UserProfile,
  goal: Goal,
): PersonModel {
  const fresh = buildBasePersonModel(profile, goal);
  if (!existing?.sections?.length) return fresh;

  const fromProfile = (f: MemoryFact) => f.source === 'Анкета' || f.source.startsWith('Файл: ');
  const oldTexts = new Set<string>();
  const newTexts = new Set<string>();
  for (const sec of existing.sections) for (const f of sec.facts) if (fromProfile(f)) oldTexts.add(f.text);
  for (const sec of fresh.sections) for (const f of sec.facts) newTexts.add(f.text);

  const sections = existing.sections.map((sec) => {
    const freshSec = fresh.sections.find((x) => x.id === sec.id);
    if (!freshSec) return sec;
    const oldProfile = sec.facts.filter(fromProfile);
    const merged = freshSec.facts.map((nf) => oldProfile.find((of) => of.text === nf.text) ?? nf);
    return { ...sec, facts: [...merged, ...sec.facts.filter((f) => !fromProfile(f))], gaps: [...sec.gaps] };
  });

  const journal = [...existing.journal];
  let logged = 0;
  for (const t of newTexts) {
    if (!oldTexts.has(t) && logged++ < 12) {
      journal.push({ at: nowIso(), kind: 'clarified', text: `Обновлено в профиле: ${t}`, source: 'Анкета' });
    }
  }
  for (const t of oldTexts) {
    if (!newTexts.has(t) && logged++ < 12) {
      journal.push({ at: nowIso(), kind: 'clarified', text: `Больше не актуально: ${t}`, source: 'Анкета' });
    }
  }

  const model: PersonModel = {
    ...existing,
    sections,
    inferences: [...existing.inferences],
    openQuestions: [...existing.openQuestions],
    journal,
    updatedAt: nowIso(),
  };
  recomputeConfidence(model, profile);
  return model;
}

/* ==================== 2) Обогащение от анализа ИИ ==================== */

export interface LlmMemoryPayload {
  inferences?: { text?: string; basis?: string }[];
  sectionConfidence?: { id?: string; confidence?: number; gaps?: string[] }[];
  openQuestions?: string[];
}

/**
 * Вливает результаты глубокого анализа ИИ в базовую модель:
 * выводы с обоснованием, точные уверенности по секциям, открытые вопросы.
 * Ничего не теряет: факты из анкеты остаются, ИИ добавляет понимание.
 */
export function applyAnalysisMemory(
  base: PersonModel,
  payload: LlmMemoryPayload | null | undefined,
  opts: { forced?: boolean } = {},
): PersonModel {
  const model: PersonModel = {
    ...base,
    sections: base.sections.map((s) => ({ ...s, facts: [...s.facts], gaps: [...s.gaps] })),
    inferences: [...base.inferences],
    openQuestions: [...base.openQuestions],
    journal: [...base.journal],
  };
  if (!payload) {
    model.overallConfidence = opts.forced ? Math.max(model.overallConfidence, 75) : model.overallConfidence;
    return model;
  }

  // Выводы ИИ (без дубликатов при повторных анализах)
  for (const inf of payload.inferences || []) {
    const text = (inf?.text || '').trim();
    if (!text) continue;
    if (model.inferences.some((i) => i.text.toLowerCase() === text.toLowerCase())) continue;
    if (model.journal.some((j) => j.kind === 'inferred' && j.text.toLowerCase() === text.toLowerCase()))
      continue;
    model.inferences.push({ text, basis: (inf?.basis || '').trim() });
    model.journal.push({ at: nowIso(), kind: 'inferred', text, source: 'Вывод ИИ' });
  }

  // Уверенности и пробелы по секциям (сначала пробелы, потом уверенность)
  for (const row of payload.sectionConfidence || []) {
    const id = (row?.id || '').trim();
    const sec = model.sections.find((s) => s.id === id);
    if (!sec) continue;
    for (const g of row.gaps || []) {
      const t = (g || '').trim();
      if (t && !sec.gaps.includes(t)) sec.gaps.push(t);
    }
    if (typeof row.confidence === 'number' && Number.isFinite(row.confidence)) {
      const llm = clampConf(row.confidence, sec.confidence);
      // если в секции есть факты — уверенность не может упасть ниже расчётной
      // наполненности (факты + пробелы): ИИ уточняет, но не обнуляет известное
      const factsN = sec.facts.length;
      const baseline =
        factsN > 0
          ? Math.max(20, Math.min(95, factsN * 28 + 15) - Math.min(45, sec.gaps.length * 18))
          : 0;
      sec.confidence = Math.max(llm, baseline);
    }
  }

  // Открытые вопросы
  for (const q of payload.openQuestions || []) {
    const t = (q || '').trim();
    if (t && !model.openQuestions.includes(t)) model.openQuestions.push(t);
  }

  recomputeOverall(model);
  return model;
}

/* ================= 3) Обновление от ответа в чате ================= */

export interface ChatMemoryUpdate {
  sectionId?: string;
  facts?: string[];
  resolvedGaps?: string[];
  corrections?: string[];
}

function guessSection(message: string): string {
  const m = message.toLowerCase();
  if (/немец|язык|deutsch|a1|a2|b1|b2|c1|английск/.test(m)) return 'languages';
  if (/виз|паспорт|документ|разрешен|гражданств/.test(m)) return 'documents';
  if (/школ|аттестат|балл|оценк|abitur|realschul|hauptschul|gymnasium/.test(m)) return 'education';
  if (/город|район|радиус|км|переез| готов ездить/.test(m)) return 'location';
  if (/зарплат|доход|евро|платя|формат|смен|график|неполн/.test(m)) return 'conditions';
  if (/опыт|стаж|практик|умел|навык|права категор/.test(m)) return 'experience';
  if (/хочу|интерес|нрав|професс|ausbild|сфер|направлен/.test(m)) return 'direction';
  if (/боюсь|проблем|сложно|трудност|ограничен/.test(m)) return 'constraints';
  return 'identity';
}

/**
 * Вливает ответ человека в память: новые факты (источник «Ответ в чате»),
 * снятые пробелы, исправления. Возвращает НОВУЮ модель (иммутабельно)
 * и записи журнала. Работает без ИИ (эвристика), поэтому надёжно.
 */
export function mergeChatAnswer(model: PersonModel, message: string, updates?: ChatMemoryUpdate[]): PersonModel {
  const trimmed = message.trim();
  if (!trimmed) return model;
  const next: PersonModel = {
    ...model,
    sections: model.sections.map((s) => ({ ...s, facts: [...s.facts], gaps: [...s.gaps] })),
    inferences: model.inferences.map((i) => ({ ...i })),
    openQuestions: [...model.openQuestions],
    journal: [...model.journal],
  };

  const pushFact = (sectionId: string, text: string) => {
    const sec = next.sections.find((s) => s.id === sectionId) || next.sections[0];
    const clean = text.trim();
    if (!clean) return;
    // не дублируем уже известное
    if (sec.facts.some((f) => f.text.toLowerCase() === clean.toLowerCase())) return;
    // разрешение противоречий: новая формулировка «Тема: значение» вытесняет
    // старый факт по той же теме (например «Немецкий: B1» → «Немецкий: B2»)
    const topic = clean.split(/[:—–]/)[0].trim().toLowerCase();
    if (topic.length >= 4) {
      const outdated = sec.facts.filter(
        (f) => f.text.toLowerCase().split(/[:—–]/)[0].trim().toLowerCase() === topic,
      );
      for (const old of outdated) {
        next.journal.push({
          at: nowIso(),
          kind: 'clarified',
          text: `Уточнил: «${old.text}» → «${clean}»`,
          source: 'Ответ в чате',
        });
      }
      sec.facts = sec.facts.filter((f) => !outdated.includes(f));
    }
    sec.facts.push(fact(clean, 'Ответ в чате', 92));
    next.journal.push({ at: nowIso(), kind: 'clarified', text: clean, source: 'Ответ в чате' });
  };

  if (updates?.length) {
    for (const u of updates) {
      const id = u.sectionId && next.sections.some((s) => s.id === u.sectionId) ? u.sectionId : guessSection(trimmed);
      for (const f of u.facts || []) pushFact(id, f);
      const sec = next.sections.find((s) => s.id === id);
      if (sec) {
        for (const g of u.resolvedGaps || []) {
          sec.gaps = sec.gaps.filter((x) => !x.toLowerCase().includes((g || '').toLowerCase().slice(0, 24)));
        }
      }
    }
  } else {
    // эвристика: весь ответ идёт в подходящую секцию одним фактом
    pushFact(guessSection(trimmed), trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed);
  }

  for (const c of (updates || []).flatMap((u) => u.corrections || [])) {
    if (c?.trim()) {
      next.journal.push({ at: nowIso(), kind: 'clarified', text: `Уточнение: ${c.trim()}`, source: 'Ответ в чате' });
    }
  }

  // часть открытых вопросов могла закрыться этим ответом
  next.openQuestions = next.openQuestions.filter(
    (q) => !trimmedFitsQuestion(trimmed, q),
  );

  recomputeOverall(next);
  next.updatedAt = nowIso();
  return next;
}

/** Грубая проверка: похоже, ответ закрывает этот вопрос (по ключевым словам). */
function trimmedFitsQuestion(answer: string, question: string): boolean {
  const stop = new Set(['какой', 'какая', 'какие', 'чего', 'что', 'ты', 'вы', 'и', 'в', 'на', 'есть', 'ли', 'о', 'об']);
  const qw = question
    .toLowerCase()
    .replace(/[?!.,;:»«()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w));
  if (!qw.length) return false;
  const hit = qw.filter((w) => answer.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2)))).length;
  return hit / qw.length >= 0.6;
}

/* ===================== 4) Уверенности ===================== */

/** Пересчёт уверенности секций: с учётом полураспада доверия к фактам. */
function recomputeConfidence(model: PersonModel, profile?: UserProfile) {
  recomputeDecayAware(model);
  if (profile?.wizardSkipped?.length && !model.sections.some((s) => s.facts.length)) {
    model.overallConfidence = Math.min(model.overallConfidence, 35);
  }
}

function recomputeOverall(model: PersonModel, profile?: UserProfile) {
  recomputeConfidence(model, profile);
}

/* ===================== 5) Текст для промптов ===================== */

/**
 * Компактное текстовое представление модели — для системных промптов
 * чата и поиска. Гораздо короче сырой анкеты и уже содержит выводы ИИ,
 * пробелы и уверенности, поэтому агент отвечает опираясь на память.
 */
export function personModelToText(model: PersonModel | null | undefined): string {
  if (!model || !model.sections.length) return '';
  const now = Date.now();
  const lines: string[] = [];
  for (const sec of model.sections) {
    if (!sec.facts.length && !sec.gaps.length) continue;
    lines.push(`[${sec.title}] (понимание ${sec.confidence}%)`);
    for (const f of sec.facts) {
      const eff = factEffective(f, sec.id, now);
      const stale = factStatusOf(eff) === 'stale';
      const mark = stale ? ' [ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ — могло устареть, мягко переспроси]' : '';
      lines.push(`  - ${f.text} [источник: ${f.source}; уверен(а) на ${eff}%]${mark}`);
    }
    for (const g of sec.gaps) lines.push(`  ? неясно: ${g}`);
  }
  if (model.inferences.length) {
    lines.push('[Выводы ИИ о человеке]');
    for (const inf of model.inferences) {
      lines.push(`  - ${inf.text}${inf.basis ? ` (потому что: ${inf.basis})` : ''}`);
    }
  }
  if (model.openQuestions.length) {
    lines.push(`[Открытые вопросы] ${model.openQuestions.join(' | ')}`);
  }
  const archived = (model.archivedFacts ?? []).length;
  if (archived) {
    lines.push(`[Забыто по времени: ${archived} факт(ов) — они в архиве памяти и в поиске не участвуют; человек может восстановить их через панель «Память агента»]`);
  }
  lines.push(`[Общее понимание человека: ${model.overallConfidence}%]`);
  return lines.join('\n');
}
