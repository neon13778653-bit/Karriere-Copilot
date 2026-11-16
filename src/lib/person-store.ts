// Долговременная память человека (PersonMemory) — переносится между сессиями.
//
// Одна локальная «картотека» (key = "local"): модель человека, последний снимок
// анкеты и счётчик сессий. Любая сессия при рождении получает память этого
// человека: агент встречает не незнакомца, а знакомого. После анализа анкеты
// и каждого осмысленного ответа в чате память синхронизируется обратно.

import type { Goal, PersonMemoryMeta, PersonModel, SweepReport, UserProfile } from './types';
import { db } from './db';
import { stripDecorativeEmojis } from './emoji';
import { sweepMemory } from './memory-decay';
import { buildBasePersonModel, personModelToText } from './person-model';
import { parseProfile } from './types';

const KEY = 'local';

export interface PersonState {
  model: PersonModel | null;
  profile: UserProfile | null;
  meta: PersonMemoryMeta;
}

export async function readPersonState(): Promise<PersonState> {
  const row = await db.personMemory.findUnique({ where: { key: KEY } });
  return {
    model: parseModel(row?.model),
    profile: parseProfile(row?.profile ?? null),
    meta: {
      sessionsCount: row?.sessionsCount ?? 0,
      firstSeenAt: row?.firstSeenAt?.toISOString() ?? null,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      lastGoal: (row?.lastGoal as Goal | null) ?? null,
    },
  };
}

function parseModel(raw?: string | null): PersonModel | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PersonModel;
    return v && Array.isArray(v.sections) ? v : null;
  } catch {
    return null;
  }
}

function hasFacts(model: PersonModel | null): boolean {
  return !!model && model.sections.some((s) => s.facts.length > 0);
}

/**
 * Сохранить/обновить долговременную память человека.
 * Модель проходит «уборку» (полураспад + архив), снимок анкеты — для переноса.
 */
export async function savePersonMemory(opts: {
  model: PersonModel | null;
  profile: UserProfile | null;
  goal: Goal | null;
  bumpSessions?: boolean;
}): Promise<{ model: PersonModel | null; report: SweepReport | null }> {
  const existing = await db.personMemory.findUnique({ where: { key: KEY } });
  const sessionsCount = (existing?.sessionsCount ?? 0) + (opts.bumpSessions ? 1 : 0);

  let swept: PersonModel | null = null;
  let report: SweepReport | null = null;
  if (hasFacts(opts.model)) {
    const r = sweepMemory(opts.model!);
    swept = r.model;
    report = r.report;
  }

  const data = {
    model: swept ? JSON.stringify(swept) : existing?.model ?? null,
    profile: opts.profile ? JSON.stringify(opts.profile) : existing?.profile ?? null,
    lastGoal: opts.goal ?? existing?.lastGoal ?? null,
    sessionsCount,
    lastSyncAt: new Date(),
  };

  await db.personMemory.upsert({ where: { key: KEY }, create: { key: KEY, ...data }, update: data });
  return { model: swept, report };
}

/** Прогнать уборку памяти и сохранить результат (для GET /api/memory). */
export async function sweepAndStore(): Promise<{ model: PersonModel | null; report: SweepReport | null }> {
  const { model, report } = await loadAndSweepPersonState();
  return { model, report };
}

/**
 * Загрузить память человека с уборкой по времени: полураспад + архив +
 * сохранение изменений. Вызывается и при чтении панели, и при рождении
 * новой сессии — забывание работает по реальному времени.
 */
export async function loadAndSweepPersonState(): Promise<{
  state: PersonState;
  model: PersonModel | null;
  report: SweepReport | null;
}> {
  const state = await readPersonState();
  if (!hasFacts(state.model)) return { state, model: state.model, report: null };
  const { model, report } = sweepMemory(state.model!);
  const changed = report.forgottenNow.length > 0 || JSON.stringify(model) !== JSON.stringify(state.model);
  if (changed) {
    const data = { model: JSON.stringify(model), lastSyncAt: new Date() };
    await db.personMemory.update({ where: { key: KEY }, data }).catch(() => null);
  }
  return { state, model, report };
}

export { prefillFromProfile } from './profile-wizard';

/** Приветствие «С возвращением» — агент помнит человека между сессиями. */
export function buildWelcomeBackText(opts: {
  goal: Goal;
  profile: UserProfile | null;
  model: PersonModel | null;
  meta: PersonMemoryMeta;
  report: SweepReport | null;
  prefillCount: number;
  isWizard: boolean;
}): string | null {
  const { goal, model, meta, report, prefillCount, isWizard } = opts;
  if (!hasFacts(model)) return null;

  const name = opts.profile?.name?.trim();
  const goalWord =
    goal === 'ausbildung' ? 'Ausbildung' : goal === 'job' ? 'поиск работы' : 'наш чат';
  const visitN = (meta.sessionsCount ?? 0) + 1;

  const parts: string[] = [];
  parts.push(`### С возвращением${name ? `, ${name}` : ''}!`);
  parts.push('');
  parts.push(
    `Это наша **${visitN}-я сессия** — я помню тебя с ${formatDate(meta.firstSeenAt)} и перенёс всю память из прошлых разговоров в этот ${goalWord}.`,
  );

  // Что агент помнит — самые важные факты из памяти
  const modelText = personModelToText(model);
  const highlights = extractHighlights(model!);
  if (highlights.length) {
    parts.push('');
    parts.push('**Что я о тебе помню:**');
    for (const h of highlights) parts.push(`- ${h}`);
  }

  // Устаревшие факты — мягко просим перепроверить
  const stale = report?.staleNow?.length ? report.staleNow : staleFactsFromText(modelText);
  if (stale.length) {
    parts.push('');
    parts.push('**Некоторые данные давно не подтверждались — могло устареть:**');
    for (const s of stale.slice(0, 5)) parts.push(`- ${s}`);
    parts.push('');
    parts.push(
      isWizard
        ? 'Я уже вставил их в анкету — просто проверь по ходу и поправь, если что-то изменилось.'
        : 'Если что-то изменилось — просто напиши в чат, я обновлю память.',
    );
  }

  // Что забыто по времени — честно говорим
  if (report?.forgottenNow?.length) {
    parts.push('');
    parts.push(
      `**Я забыл ${report.forgottenNow.length} устаревших факт(ов)** — давно не подтверждались, срок хранения вышел. Они лежат в архиве на странице профиля («Память агента»), там их можно восстановить.`,
    );
  }

  if (isWizard && prefillCount > 0) {
    parts.push('');
    parts.push(
      `В анкету я уже перенёс ${prefillCount} пол(ей) из прошлых сессий — ничего не придётся набирать заново.`,
    );
  }

  parts.push('');
  parts.push('Если всё в силе — продолжаем с того же места. Если что-то поменялось, я быстро перестроюсь.');
  return stripDecorativeEmojis(parts.join('\n'));
}

/** Короткая выжимка памяти для приветствия: по паре фактов из ключевых секций. */
function extractHighlights(model: PersonModel): string[] {
  const out: string[] = [];
  const pushFrom = (id: string, n = 1) => {
    const sec = model.sections.find((s) => s.id === id);
    if (!sec) return;
    for (const f of sec.facts.slice(0, n)) out.push(f.text);
  };
  pushFrom('identity');
  pushFrom('direction');
  pushFrom('education');
  pushFrom('languages');
  pushFrom('location');
  pushFrom('experience');
  return out.slice(0, 6);
}

function staleFactsFromText(modelText: string): string[] {
  return modelText
    .split('\n')
    .filter((l) => l.includes('[ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ'))
    .map((l) =>
      l
        .replace(/^\s*-\s*/, '')
        .replace(/\s*\[источник:[^\]]*\]/, '')
        .replace(/\s*\[ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ[^\]]*\]/, '')
        .trim(),
    );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'первой встречи';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'первой встречи';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Гарантированная модель для сессии: память человека или пустая база. */
export function modelForNewSession(personModel: PersonModel | null, goal: Goal, profile: UserProfile | null): PersonModel | null {
  if (hasFacts(personModel)) return personModel;
  if (profile && (profile.name || profile.city || profile.graduation)) {
    return buildBasePersonModel(profile, goal);
  }
  return null;
}
