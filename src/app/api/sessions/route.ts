// Сессии: список и создание

import { NextResponse } from 'next/server';
import { stripDecorativeEmojis } from '@/lib/emoji';
import { db } from '@/lib/db';
import { parseProfile } from '@/lib/types';
import type { Goal, SessionStage, UserProfile } from '@/lib/types';
import { buildWelcomeBackText, loadAndSweepPersonState, prefillFromProfile } from '@/lib/person-store';

export async function GET() {
  const sessions = await db.searchSession.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, goal: true, stage: true, updatedAt: true, profile: true },
  });

  // Лечим сессии, где цель в профиле не совпадает с целью сессии (старые версии)
  const TITLE_PREFIX_RE = /^(Работа|Ausbildung|Поиск работы|Профиль)\s*:/;
  const fixed: { id: string; goal: string; title: string }[] = [];
  const rows = sessions.map((s) => {
    const profile = parseProfile(s.profile);
    const pGoal = profile?.goal;
    let goal = s.goal as Goal;
    let title = s.title;
    if ((pGoal === 'job' || pGoal === 'ausbildung') && pGoal !== goal) {
      const prefix = pGoal === 'ausbildung' ? 'Ausbildung' : 'Работа';
      title = (
        TITLE_PREFIX_RE.test(s.title)
          ? `${prefix}:${s.title.slice(s.title.indexOf(':') + 1)}`
          : s.title
      ).slice(0, 120);
      goal = pGoal;
      fixed.push({ id: s.id, goal, title });
    }
    return {
      id: s.id,
      title,
      goal,
      stage: (s.stage || 'chat') as SessionStage,
      updatedAt: s.updatedAt.toISOString(),
      profile,
    };
  });
  for (const f of fixed) {
    await db.searchSession.update({ where: { id: f.id }, data: { goal: f.goal, title: f.title } }).catch(() => null);
  }

  return NextResponse.json({ sessions: rows });
}

function greeting(goal: Goal): string {
  if (goal === 'chat') {
    return stripDecorativeEmojis(
      [
        'Привет! Я **Karriere Copilot** — твой ИИ-агент по работе и Ausbildung в Германии.',
        '',
        'Могу:',
        '- искать вакансии и учебные места по всем немецким порталам;',
        '- подобрать Ausbildung или профессию под твой профиль — даже если ещё не определился;',
        '- помочь с Lebenslauf, мотивационным письмом и подготовкой к собеседованию;',
        '- подсказать по визам (Chancenkarte, Blue Card, §18a/b) и признанию диплома.',
        '',
        'Чтобы я понимал, кого и где искать, заполни анкету профиля — кнопка **«Профиль»** в шапке чата. Можно пропускать то, чего не знаешь, и приложить файлы: Lebenslauf, аттестат, сертификаты. После отправки анкеты я глубоко проанализирую ответы и, если что-то будет неясно, задам уточняющие вопросы прямо здесь. А когда пойму тебя на 100% — спрошу: «Готов начать поиск?»',
      ].join('\n'),
    );
  }
  const isAusbildung = goal === 'ausbildung';
  return stripDecorativeEmojis(
    [
      `Привет! Я **Karriere Copilot** — ИИ-агент по поиску ${isAusbildung ? 'мест Ausbildung' : 'работы'} в Германии.`,
      '',
      'Сейчас перед тобой анкета профиля — она заполняется по этапам, как регистрация:',
      '- отвечай на вопросы — или жми **«Пропустить»** / **«Не определился»**, я подберу по остальным ответам;',
      '- можно приложить файлы: Lebenslauf, аттестат, сертификаты (PDF, DOCX, TXT) — я их прочитаю;',
      '- на любом этапе можно вернуться в чат и что-то спросить.',
      '',
      'После отправки анкеты я **внимательно и глубоко** изучу ответы, пойму, кто ты и что тебе подходит. Если что-то останется неясным — задам уточняющие вопросы прямо в чате, а когда пойму на 100% — спрошу: «Готов начать поиск?»',
    ].join('\n'),
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const goal: Goal = ['job', 'ausbildung', 'chat'].includes(body?.goal) ? body.goal : 'chat';

  // Поиск работы / Ausbildung → сразу анкета-разговор в чате
  const stage: SessionStage = goal === 'chat' ? 'chat' : 'wizard';

  /* ---- Перенос памяти между сессиями одного человека (с уборкой по времени) ---- */
  const { state: person, model: sweptModel, report: sweepReport } = await loadAndSweepPersonState();
  const returning = !!sweptModel && sweptModel.sections.some((s) => s.facts.length > 0);
  const prefill = returning ? prefillFromProfile(person.profile, goal) : {};

  let profile: UserProfile | null;
  if (goal === 'chat') {
    profile = returning ? { goal, ...prefill, personModel: sweptModel ?? undefined } : null;
  } else {
    profile = { goal, ...prefill, personModel: sweptModel ?? undefined };
  }
  const title = goal === 'job' ? 'Поиск работы' : goal === 'ausbildung' ? 'Ausbildung' : 'Новый чат';

  // Приветствие: для знакомого человека — «С возвращением» с памятью
  const welcomeBack = returning
    ? buildWelcomeBackText({
        goal,
        profile: person.profile,
        model: sweptModel,
        meta: person.meta,
        report: sweepReport,
        prefillCount: Object.keys(prefill).length,
        isWizard: goal !== 'chat',
      })
    : null;

  const session = await db.searchSession.create({
    data: {
      title,
      goal,
      stage,
      profile: profile ? JSON.stringify(profile) : null,
      messages: {
        create: {
          role: 'assistant',
          content: welcomeBack ? `${greeting(goal)}\n\n---\n\n${welcomeBack}` : greeting(goal),
        },
      },
    },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  // счётчик сессий у долговременной памяти (для «наша N-я сессия»)
  if (returning) {
    await db.personMemory
      .update({ where: { key: 'local' }, data: { sessionsCount: { increment: 1 }, lastSyncAt: new Date() } })
      .catch(() => null);
  } else {
    await db.personMemory
      .upsert({ where: { key: 'local' }, create: { key: 'local', sessionsCount: 1 }, update: { sessionsCount: { increment: 1 } } })
      .catch(() => null);
  }

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      goal: session.goal as Goal,
      stage: (session.stage || 'chat') as SessionStage,
      updatedAt: session.updatedAt.toISOString(),
      profile,
    },
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      vacancyIds: [],
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
