// Одна сессия: получить / обновить профиль и стадию / удалить

import { NextResponse } from 'next/server';
import { stripDecorativeEmojis } from '@/lib/emoji';
import { resolveGoal } from '@/lib/goal-sync';
import { db } from '@/lib/db';
import { normalizeCustomSections } from '@/lib/custom-sections';
import { refreshAnketaFacts } from '@/lib/person-model';
import { parseIntel } from '@/lib/vacancy-intel';
import { parseProfile } from '@/lib/types';
import type { Goal, SessionStage, UserProfile } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await db.searchSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      vacancies: { orderBy: [{ score: 'desc' }, { createdAt: 'desc' }] },
    },
  });
  if (!session) return NextResponse.json({ error: 'Сессия не найдена' }, { status: 404 });

  // Цель: если в профиле указана job/ausbildung — она главная (лечит старые сессии)
  const { goal: sessionGoal, profile: healedProfile } = await resolveGoal({
    id: session.id,
    goal: session.goal,
    title: session.title,
    profile: session.profile,
  });
  const title = sessionGoal !== session.goal
    ? (await db.searchSession.findUnique({ where: { id }, select: { title: true } }))?.title ?? session.title
    : session.title;

  const parseIds = (meta: string | null): string[] => {
    if (!meta) return [];
    try {
      const v = JSON.parse(meta);
      return Array.isArray(v?.vacancyIds) ? v.vacancyIds.filter((x: unknown) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

  return NextResponse.json({
    session: {
      id: session.id,
      title,
      goal: sessionGoal,
      stage: (session.stage || 'chat') as SessionStage,
      updatedAt: session.updatedAt.toISOString(),
      profile: healedProfile ?? parseProfile(session.profile),
    },
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      // очистка от декоративных эмодзи прямо при чтении — лечит старые сообщения
      content: m.role === 'assistant' ? stripDecorativeEmojis(m.content) : m.content,
      vacancyIds: parseIds(m.meta),
      createdAt: m.createdAt.toISOString(),
    })),
    vacancies: session.vacancies.map((v) => ({
      id: v.id,
      title: stripDecorativeEmojis(v.title),
      company: v.company ? stripDecorativeEmojis(v.company) : null,
      location: v.location ? stripDecorativeEmojis(v.location) : null,
      url: v.url,
      source: v.source,
      salary: v.salary ? stripDecorativeEmojis(v.salary) : null,
      description: v.description ? stripDecorativeEmojis(v.description) : null,
      snippet: v.snippet ? stripDecorativeEmojis(v.snippet) : null,
      score: v.score,
      verdict: v.verdict ? stripDecorativeEmojis(v.verdict) : null,
      reasons: v.reasons ? safeArr(v.reasons).map(stripDecorativeEmojis) : null,
      risks: v.risks ? safeArr(v.risks).map(stripDecorativeEmojis) : null,
      tags: v.tags ? safeArr(v.tags).map(stripDecorativeEmojis) : null,
      searchMode: v.searchMode,
      intel: parseIntel((v as { intel?: string | null }).intel),
    })),
  });
}

function safeArr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const STAGES: SessionStage[] = ['wizard', 'analysis', 'ready', 'chat'];

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: { profile?: string; title?: string; stage?: string; goal?: string } = {};
  let newProfile: UserProfile | null = null;
  if (body?.profile && typeof body.profile === 'object') {
    newProfile = body.profile as UserProfile;
    // свои разделы приходят от клиента — приводим к безопасному виду (лимиты, типы)
    const custom = normalizeCustomSections(newProfile.customSections);
    if (custom === undefined) delete newProfile.customSections;
    else newProfile.customSections = custom;
    data.profile = JSON.stringify(newProfile);
  }
  if (typeof body?.title === 'string' && body.title.trim()) {
    data.title = body.title.trim().slice(0, 120);
  }
  if (typeof body?.stage === 'string' && STAGES.includes(body.stage as SessionStage)) {
    data.stage = body.stage;
  }
  if (typeof body?.goal === 'string' && ['job', 'ausbildung', 'chat'].includes(body.goal)) {
    data.goal = body.goal;
  }
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Нечего обновлять' }, { status: 400 });
  }
  // Правка профиля без повторного анализа: обновляем в памяти факты из анкеты, выводы не трогаем
  if (body?.refreshMemory && newProfile) {
    const current = data.goal
      ? null
      : await db.searchSession.findUnique({ where: { id }, select: { goal: true } });
    const goalForModel = (data.goal ?? current?.goal ?? newProfile.goal ?? 'chat') as Goal;
    newProfile = {
      ...newProfile,
      personModel: refreshAnketaFacts(newProfile.personModel, newProfile, goalForModel),
    };
    data.profile = JSON.stringify(newProfile);
  }

  const session = await db.searchSession.update({ where: { id }, data });

  // Синхронизация долговременной памяти человека (по флагу с фронта —
  // например при отправке анкеты агенту; черновики анкеты память не трогают)
  if (body?.syncMemory && newProfile) {
    const { savePersonMemory } = await import('@/lib/person-store');
    const goal = (session.goal as Goal) ?? newProfile.goal ?? 'chat';
    await savePersonMemory({
      model: newProfile.personModel ?? null,
      profile: newProfile,
      goal,
    }).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    title: session.title,
    profile: parseProfile(session.profile),
    stage: (session.stage || 'chat') as SessionStage,
    goal: session.goal as Goal,
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await db.searchSession.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
