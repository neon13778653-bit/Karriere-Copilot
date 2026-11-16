// Запуск поиска: SSE-прогресс + финальные вакансии

import { stripDecorativeEmojis } from '@/lib/emoji';
import { resolveGoal } from '@/lib/goal-sync';
import { db } from '@/lib/db';
import { runSearchPipeline } from '@/lib/search';
import { readBackend, sseResponse } from '@/lib/sse';
import { parseProfile, MODE_META } from '@/lib/types';
import type { AgentEvent, SearchMode } from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId: string = body?.sessionId;
  const mode: SearchMode = ['easy', 'medium', 'max'].includes(body?.mode) ? body.mode : 'medium';

  if (!sessionId) {
    return Response.json({ error: 'Нужен sessionId' }, { status: 400 });
  }

  const session = await db.searchSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  }

  const profileParsed = parseProfile(session.profile) ?? {
    goal: session.goal as 'job' | 'ausbildung' | 'chat',
  };
  // Цель: приоритет у профиля — агент ищет именно то, что выбрал человек
  const { goal: healedGoal, profile } = await resolveGoal({
    id: session.id,
    goal: session.goal,
    title: session.title,
    profile: session.profile,
  });
  const goal = healedGoal;
  const profileFinal = profile ?? profileParsed;

  // Если агент уже глубоко проанализировал профиль перед поиском — переиспользуем
  const savedAnalysis =
    profileFinal.aiDirections?.length && profileFinal.aiAnalysis
      ? { portrait: profileFinal.aiAnalysis, directions: profileFinal.aiDirections }
      : null;

  // Фиксируем действие пользователя в истории
  await db.message.create({
    data: {
      sessionId,
      role: 'user',
      content: `Запусти поиск в режиме «${MODE_META[mode].label}»`,
    },
  });

  async function* generate(): AsyncGenerator<AgentEvent> {
    let savedSummary = false;
    let savedAnalysisMsg = false;
    const pipeline = runSearchPipeline({
      profile: profileFinal,
      goal,
      mode,
      sessionId,
      backend: readBackend(body),
      savedAnalysis,
    });
    for await (const evt of pipeline) {
      if (evt.type === 'analysis' && !savedAnalysisMsg) {
        savedAnalysisMsg = true;
        // Показ анализа как сообщения агента в чате
        await db.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: stripDecorativeEmojis(evt.text),
            meta: JSON.stringify({ kind: 'analysis' }),
          },
        });
        // Сохраняем анализ в профиль — агент будет опираться на него в дальнейших ответах
        try {
          const fresh = await db.searchSession.findUnique({ where: { id: sessionId } });
          const prof = parseProfile(fresh?.profile) ?? { goal };
          await db.searchSession.update({
            where: { id: sessionId },
            data: {
              profile: JSON.stringify({
                ...prof,
                aiAnalysis: stripDecorativeEmojis(evt.text),
                aiDirections: evt.directions,
              }),
            },
          });
        } catch {
          // не критично
        }
      }
      if (evt.type === 'vacancies' && !savedSummary) {
        savedSummary = true;
        await db.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: stripDecorativeEmojis(evt.summary),
            meta: JSON.stringify({ vacancyIds: evt.items.map((v) => v.id) }),
          },
        });
      }
      if (evt.type === 'error') {
        await db.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: stripDecorativeEmojis(evt.message),
          },
        });
      }
      yield evt;
    }
    yield { type: 'done' };
  }

  return sseResponse(generate());
}
