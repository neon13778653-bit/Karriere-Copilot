// Забывание по времени — полураспад доверия к фактам.
//
// Идея: память агента как человеческая. Факт со временем «выцветает»:
// эффективная уверенность = базовая уверенность × 0.5 ^ (дней / полураспад).
//
//   свежий    (≥70)  — агент уверенно опирается на факт
//   давний    (≥45)  — нормальная давность, можно опираться
//   устаревает(≥20) — агент мягко перепроверяет факт в разговоре
//   забыто    (<20)  — факт уезжает в архив памяти, агент им больше не пользуется
//
// Подтверждение факта человеком сбрасывает часы: confirmedAt = сейчас.
// Архив — не мусорка: факт можно восстановить или удалить навсегда.

import type {
  FactStatus,
  JournalEntry,
  MemoryFact,
  PersonModel,
  SweepReport,
} from './types';

/* ================= Политики полураспада ================= */

/** Полураспад по секциям (в днях): насколько долго грань жизни остаётся верной. */
export const HALF_LIFE_BY_SECTION: Record<string, number> = {
  identity: 540, // имя, возраст — почти не меняются
  education: 540, // школа, аттестат, балл — константа биографии
  languages: 360, // уровень языка растёт медленно
  documents: 300, // визы/разрешения — обновляются редко
  experience: 300, // опыт накапливается, старые записи валидны долго
  motivation: 240, // интересы и ценности меняются не быстро
  direction: 150, // цель и направления — могут смениться за полгода
  constraints: 150,
  location: 150, // город/радиус — переезд меняет всё
  conditions: 90, // ожидания по доходу и формату — самые «живые»
};

/** Множитель полураспада по источнику: чат «мягче» анкеты, выводы ИИ — ещё мягче. */
export function sourceHalfLifeFactor(source: string): number {
  if (source.startsWith('Файл:')) return 1.15; // документы надёжны
  if (source === 'Анкета') return 1.0;
  if (source === 'Анализ анкеты') return 0.85;
  if (source === 'Ответ в чате') return 0.7; // сказанное мимоходом устаревает быстрее
  if (source === 'Вывод ИИ') return 0.6; // умозаключение стоит перепроверять чаще
  return 0.8;
}

export const FACT_FORGOTTEN_BELOW = 20; // ниже — забыто
export const FACT_STALE_BELOW = 45; // ниже — устаревает
export const FACT_FRESH_ABOVE = 70; // выше — свежий

/* ================= Расчёты ================= */

export function nowIso(): string {
  return new Date().toISOString();
}

function daysBetween(fromIso: string, now: number): number {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 86_400_000);
}

/** Полураспад конкретного факта (дней): секция × источник. */
export function factHalfLife(f: MemoryFact, sectionId: string): number {
  const base = f.halfLifeDays ?? HALF_LIFE_BY_SECTION[sectionId] ?? 180;
  return Math.max(7, base * sourceHalfLifeFactor(f.source));
}

/** Эффективная уверенность 0–100 с учётом полураспада. */
export function factEffective(f: MemoryFact, sectionId: string, now = Date.now()): number {
  const anchor = f.confirmedAt || f.at;
  const days = daysBetween(anchor, now);
  const half = factHalfLife(f, sectionId);
  const eff = f.confidence * Math.pow(0.5, days / half);
  return Math.max(0, Math.min(100, Math.round(eff)));
}

export function factStatusOf(effective: number): FactStatus {
  if (effective < FACT_FORGOTTEN_BELOW) return 'forgotten';
  if (effective < FACT_STALE_BELOW) return 'stale';
  if (effective < FACT_FRESH_ABOVE) return 'aging';
  return 'fresh';
}

export function factStatus(f: MemoryFact, sectionId: string, now = Date.now()): FactStatus {
  return factStatusOf(factEffective(f, sectionId, now));
}

/** Человеческий возраст факта: «только что», «3 дня назад», «2 мес. назад». */
export function factAgeLabel(f: MemoryFact, now = Date.now()): string {
  const anchor = f.confirmedAt || f.at;
  const t = Date.parse(anchor);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} нед. назад`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} мес. назад`;
  }
  const y = Math.floor(days / 365);
  return `${y} г. назад`;
}

/* ================= Пересчёт уверенности с распадом ================= */

/** Пересчитывает уверенности секций и общее понимание по эффективной свежести фактов. */
export function recomputeDecayAware(model: PersonModel, now = Date.now()): void {
  const weights: Record<string, number> = {
    direction: 3,
    languages: 2.5,
    documents: 2,
    education: 2,
    location: 2,
    experience: 1.5,
    identity: 1.5,
    conditions: 1,
    constraints: 1.5,
    motivation: 1,
  };
  for (const sec of model.sections) {
    const effs = sec.facts.map((f) => factEffective(f, sec.id, now));
    let base: number;
    if (!effs.length) {
      base = sec.gaps.length > 0 ? 5 : sec.confidence > 0 ? Math.min(sec.confidence, 20) : 0;
    } else {
      const avg = effs.reduce((a, b) => a + b, 0) / effs.length;
      const worst = Math.min(...effs);
      // среднее чуть тянет вниз самый слабый факт — одна гнилая картофелина заметна
      base = Math.round(avg * 0.85 + worst * 0.15);
    }
    base -= Math.min(45, sec.gaps.length * 15);
    sec.confidence = Math.max(0, Math.min(100, base));
  }
  let sum = 0;
  let wsum = 0;
  for (const sec of model.sections) {
    const w = weights[sec.id] ?? 1;
    sum += sec.confidence * w;
    wsum += w;
  }
  let overall = wsum ? Math.round(sum / wsum) : 0;
  overall = Math.min(100, overall + Math.min(8, model.inferences.length * 2));
  model.overallConfidence = Math.max(0, Math.min(100, overall));
}

function cloneModel(model: PersonModel): PersonModel {
  return {
    ...model,
    sections: model.sections.map((s) => ({ ...s, facts: [...s.facts], gaps: [...s.gaps] })),
    inferences: model.inferences.map((i) => ({ ...i })),
    openQuestions: [...model.openQuestions],
    journal: [...model.journal],
    archivedFacts: [...(model.archivedFacts ?? [])],
  };
}

function pushJournal(model: PersonModel, entry: JournalEntry) {
  model.journal.push(entry);
  if (model.journal.length > 400) model.journal = model.journal.slice(-400);
}

/* ================= Уборка памяти (sweep) ================= */

/**
 * «Уборка памяти»: прогоняет полураспад, отправляет совсем выцветшие факты
 * в архив и помечает устаревающие. Возвращает новую модель + отчёт.
 * Вызывается при загрузке долговременной памяти и при открытии новой сессии —
 * так забывание работает по реальному времени, даже если приложение молчало месяц.
 */
export function sweepMemory(model: PersonModel, now = Date.now()): { model: PersonModel; report: SweepReport } {
  const next = cloneModel(model);
  if (!next.archivedFacts) next.archivedFacts = [];
  const forgottenNow: SweepReport['forgottenNow'] = [];
  const staleNow: string[] = [];

  for (const sec of next.sections) {
    const keep: MemoryFact[] = [];
    for (const f of sec.facts) {
      const eff = factEffective(f, sec.id, now);
      if (factStatusOf(eff) === 'forgotten') {
        if (!f.forgottenAt) f.forgottenAt = nowIso();
        next.archivedFacts.push(f);
        forgottenNow.push({ section: sec.title, text: f.text });
        pushJournal(next, {
          at: nowIso(),
          kind: 'forgotten',
          text: `Забыл по времени: «${f.text}» — давно не подтверждалось`,
          source: f.source,
        });
      } else {
        if (factStatusOf(eff) === 'stale') staleNow.push(f.text);
        keep.push(f);
      }
    }
    sec.facts = keep;
  }

  recomputeDecayAware(next, now);
  next.updatedAt = nowIso();

  const report: SweepReport = {
    at: nowIso(),
    forgottenNow,
    staleNow,
    archivedTotal: next.archivedFacts.length,
  };
  return { model: next, report };
}

/* ================= Действия над фактами ================= */

function findInSections(model: PersonModel, text: string): { sectionId: string; fact: MemoryFact } | null {
  const t = text.trim().toLowerCase();
  for (const sec of model.sections) {
    const fact = sec.facts.find((f) => f.text.trim().toLowerCase() === t);
    if (fact) return { sectionId: sec.id, fact };
  }
  return null;
}

function findInArchive(model: PersonModel, text: string): MemoryFact | null {
  const t = text.trim().toLowerCase();
  return (model.archivedFacts ?? []).find((f) => f.text.trim().toLowerCase() === t) ?? null;
}

/** Человек подтвердил факт — часы распада сброшены, уверенность восстановлена. */
export function confirmFact(model: PersonModel, text: string): PersonModel {
  const next = cloneModel(model);
  const hit = findInSections(next, text);
  const arch = hit ? null : findInArchive(next, text);
  const fact = hit?.fact ?? arch;
  if (!fact) return model;
  fact.confirmedAt = nowIso();
  fact.forgottenAt = undefined;
  fact.confidence = Math.max(fact.confidence, 90);
  if (!hit && arch) {
    // возвращаем из архива в родную секцию — определяем её по смыслу текста
    const sec = pickSectionForText(next, fact.text);
    if (sec) sec.facts.push(fact);
    next.archivedFacts = (next.archivedFacts ?? []).filter((f) => f !== fact);
  }
  pushJournal(next, {
    at: nowIso(),
    kind: 'reconfirmed',
    text: `Подтвердил: «${fact.text}» — снова актуально`,
    source: 'Подтверждение',
  });
  recomputeDecayAware(next);
  next.updatedAt = nowIso();
  return next;
}

/** Забыть факт прямо сейчас (руками человека) — в архив, восстановимо. */
export function forgetFactNow(model: PersonModel, text: string, reason = 'решил забыть'): PersonModel {
  const next = cloneModel(model);
  const hit = findInSections(next, text);
  if (!hit) return model;
  const fact = hit.fact;
  const sec = next.sections.find((s) => s.id === hit.sectionId);
  if (sec) sec.facts = sec.facts.filter((f) => f !== fact);
  fact.forgottenAt = nowIso();
  next.archivedFacts = [...(next.archivedFacts ?? []), fact];
  pushJournal(next, {
    at: nowIso(),
    kind: 'forgotten',
    text: `Забыл «${fact.text}» (${reason}) — лежит в архиве, можно восстановить`,
    source: fact.source,
  });
  recomputeDecayAware(next);
  next.updatedAt = nowIso();
  return next;
}

/** Восстановить факт из архива — снова в памяти, свежесть сброшена. */
export function restoreFact(model: PersonModel, text: string): PersonModel {
  const next = cloneModel(model);
  const fact = findInArchive(next, text);
  if (!fact) return model;
  next.archivedFacts = (next.archivedFacts ?? []).filter((f) => f !== fact);
  fact.forgottenAt = undefined;
  fact.confirmedAt = nowIso();
  fact.confidence = Math.max(fact.confidence, 85);
  // родную секцию не помним — определяем по смыслу текста
  const sec = pickSectionForText(next, fact.text);
  sec.facts.push(fact);
  pushJournal(next, {
    at: nowIso(),
    kind: 'reconfirmed',
    text: `Восстановил из архива: «${fact.text}»`,
    source: fact.source,
  });
  recomputeDecayAware(next);
  next.updatedAt = nowIso();
  return next;
}

/** Удалить забытое навсегда. */
export function purgeFact(model: PersonModel, text: string): PersonModel {
  const next = cloneModel(model);
  const fact = findInArchive(next, text);
  if (!fact) return model;
  next.archivedFacts = (next.archivedFacts ?? []).filter((f) => f !== fact);
  pushJournal(next, {
    at: nowIso(),
    kind: 'forgotten',
    text: `Удалил навсегда: «${fact.text}»`,
    source: fact.source,
  });
  next.updatedAt = nowIso();
  return next;
}

/** Родная секция для факта по ключевым словам (для восстановления из архива). */
function pickSectionForText(model: PersonModel, text: string) {
  const m = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/немец|английск|язык|a1|a2|b1|b2|c1/, 'languages'],
    [/виз|паспорт|разрешен|право на работу|гражданств/, 'documents'],
    [/школ|аттестат|балл|abitur|realschul|hauptschul|gymnasium|предмет|сертификат/, 'education'],
    [/город|район|радиус|км|переез/, 'location'],
    [/зарплат|доход|евро|формат|смен|график|важно в работе/, 'conditions'],
    [/опыт|навык|права категор|практик/, 'experience'],
    [/цель|направлен|интерес|професс|ausbild/, 'direction'],
    [/сильн|нрав|мотивац|дополнител/, 'motivation'],
    [/боюсь|ограничен|риск/, 'constraints'],
  ];
  for (const [re, id] of rules) {
    if (re.test(m)) {
      const sec = model.sections.find((s) => s.id === id);
      if (sec) return sec;
    }
  }
  return model.sections.find((s) => s.id === 'identity') ?? model.sections[0];
}

/* ================= Сводки для агента и UI ================= */

/** Факты, которые пора перепроверить (с секциями). */
export function staleFacts(model: PersonModel, now = Date.now()): { sectionTitle: string; text: string; eff: number }[] {
  const out: { sectionTitle: string; text: string; eff: number }[] = [];
  for (const sec of model.sections) {
    for (const f of sec.facts) {
      const eff = factEffective(f, sec.id, now);
      if (factStatusOf(eff) === 'stale') out.push({ sectionTitle: sec.title, text: f.text, eff });
    }
  }
  return out;
}

/** Сколько фактов в каждой категории состояния — для шапки панели. */
export function factStatusCounts(model: PersonModel, now = Date.now()) {
  let fresh = 0;
  let aging = 0;
  let stale = 0;
  let archived = (model.archivedFacts ?? []).length;
  for (const sec of model.sections) {
    for (const f of sec.facts) {
      const st = factStatus(f, sec.id, now);
      if (st === 'fresh') fresh++;
      else if (st === 'aging') aging++;
      else if (st === 'stale') stale++;
    }
  }
  return { fresh, aging, stale, archived };
}
