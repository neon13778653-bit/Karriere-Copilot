// Синхронизация цели сессии с профилем: агент всегда должен знать,
// что выбрал человек — «работа» или «Ausbildung».
// Лечит сессии старых версий приложения, где цель могла не сохраниться.

import { db } from './db';
import { parseProfile } from './types';
import type { Goal, UserProfile } from './types';

/** Эффективная цель сессии: профиль важнее, если он указывает на job/ausbildung. */
export function profileGoal(profile: UserProfile | null): Goal | null {
  const g = profile?.goal;
  return g === 'job' || g === 'ausbildung' ? g : null;
}

const TITLE_PREFIX_RE = /^(Работа|Ausbildung|Поиск работы|Профиль)\s*:/;

/**
 * Проверяет сессию: если цель в профиле отличается от цели сессии —
 * обновляет сессию в БД (и префикс заголовка) и возвращает правильную цель.
 */
export async function resolveGoal(session: {
  id: string;
  goal: string;
  title: string;
  profile: string | null;
}): Promise<{ goal: Goal; profile: UserProfile | null; changed: boolean }> {
  const profile = parseProfile(session.profile);
  const pGoal = profileGoal(profile);
  const sessionGoal = (['job', 'ausbildung', 'chat'].includes(session.goal)
    ? session.goal
    : 'chat') as Goal;

  if (!pGoal || pGoal === sessionGoal) {
    return { goal: sessionGoal, profile, changed: false };
  }

  // Профиль знает цель точнее — чиним сессию (self-heal)
  const prefix = pGoal === 'ausbildung' ? 'Ausbildung' : 'Работа';
  const title = TITLE_PREFIX_RE.test(session.title)
    ? `${prefix}:${session.title.slice(session.title.indexOf(':') + 1)}`
    : session.title;

  await db.searchSession
    .update({ where: { id: session.id }, data: { goal: pGoal, title: title.slice(0, 120) } })
    .catch(() => null);

  return { goal: pGoal, profile, changed: true };
}
