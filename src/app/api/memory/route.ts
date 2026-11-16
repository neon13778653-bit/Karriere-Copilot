// Долговременная память человека: чтение (с уборкой по времени) и действия над фактами.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { confirmFact, forgetFactNow, purgeFact, restoreFact, sweepMemory } from '@/lib/memory-decay';
import { parseProfile } from '@/lib/types';
import type { PersonModel } from '@/lib/types';
import { readPersonState, savePersonMemory, sweepAndStore } from '@/lib/person-store';

export async function GET() {
  const { model, report } = await sweepAndStore();
  const state = await readPersonState();
  return NextResponse.json({
    model,
    profile: state.profile,
    meta: state.meta,
    report,
  });
}

const ACTIONS = ['confirm', 'forget', 'restore', 'purge'] as const;
type Action = (typeof ACTIONS)[number];

function apply(model: PersonModel, action: Action, text: string): PersonModel {
  switch (action) {
    case 'confirm':
      return confirmFact(model, text);
    case 'forget':
      return forgetFactNow(model, text);
    case 'restore':
      return restoreFact(model, text);
    case 'purge':
      return purgeFact(model, text);
  }
}

/**
 * Действие над фактом памяти. Меняет и долговременную память человека,
 * и память активной сессии (если передан sessionId), чтобы обе оставались синхронны.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const action = body?.action as Action;
  const factText: string = typeof body?.factText === 'string' ? body.factText.trim() : '';
  const sessionId: string | null = typeof body?.sessionId === 'string' ? body.sessionId : null;

  if (!ACTIONS.includes(action) || !factText) {
    return NextResponse.json({ error: 'Нужны action и factText' }, { status: 400 });
  }

  // 1) Долговременная память человека
  const state = await readPersonState();
  let personModel = state.model;
  if (personModel) {
    personModel = apply(personModel, action, factText);
    await savePersonMemory({ model: personModel, profile: state.profile, goal: state.meta.lastGoal });
  }

  // 2) Память активной сессии
  let sessionModel: PersonModel | null = null;
  if (sessionId) {
    const session = await db.searchSession.findUnique({ where: { id: sessionId }, select: { profile: true } });
    const profile = parseProfile(session?.profile);
    if (profile?.personModel) {
      const updated = apply(profile.personModel, action, factText);
      sessionModel = updated;
      await db.searchSession
        .update({ where: { id: sessionId }, data: { profile: JSON.stringify({ ...profile, personModel: updated }) } })
        .catch(() => null);
    }
  }

  return NextResponse.json({
    ok: true,
    model: sessionModel ?? personModel,
    personModel,
    meta: (await readPersonState()).meta,
  });
}

/** Полная очистка долговременной памяти (по запросу из панели). */
export async function DELETE() {
  await db.personMemory.deleteMany({ where: { key: 'local' } }).catch(() => null);
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
