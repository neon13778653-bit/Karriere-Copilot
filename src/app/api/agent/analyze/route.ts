// Глубокий анализ профиля после отправки анкеты агенту.
// Агент внимательно изучает ответы, понимает человека и:
//  - если понял на 100% → сообщает «готов начать поиск» (stage → ready);
//  - если есть пробелы → задаёт уточняющие вопросы прямо в чате.

import {
  MAX_ROUNDS,
  clarifyToMarkdown,
  deepAnalysisToMarkdown,
  finalizePersonModel,
  isUnderstood,
  runDeepAnalysis,
} from '@/lib/analysis';
import { stripDecorativeEmojis } from '@/lib/emoji';
import { resolveGoal } from '@/lib/goal-sync';
import { db } from '@/lib/db';
import { savePersonMemory } from '@/lib/person-store';
import { readBackend, sseResponse } from '@/lib/sse';
import { parseProfile } from '@/lib/types';
import type { AgentEvent, UserProfile } from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId: string = body?.sessionId;

  if (!sessionId) {
    return Response.json({ error: 'Нужен sessionId' }, { status: 400 });
  }

  const session = await db.searchSession.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 12 } },
  });
  if (!session) {
    return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  }

  const profileParsed = parseProfile(session.profile);
  if (!profileParsed) {
    return Response.json({ error: 'Профиль пуст — сначала заполни анкету' }, { status: 400 });
  }
  // Цель: приоритет у профиля (агент знает, что выбрано — работа или Ausbildung)
  const { goal, profile } = await resolveGoal({
    id: session.id,
    goal: session.goal,
    title: session.title,
    profile: session.profile,
  });
  const finalProfile: UserProfile = profile ?? profileParsed;
  const round = Math.max(0, Math.min(Number(finalProfile.analysisRounds) || 0, MAX_ROUNDS));
  const history = [...session.messages].reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, 1500),
  }));

  async function* generate(): AsyncGenerator<AgentEvent> {
    yield {
      type: 'step',
      key: 'understand',
      label: 'Внимательно и глубоко анализирую твою анкету',
      status: 'active',
    };
    yield {
      type: 'log',
      text: 'Читаю анкету строка за строкой: школа, оценки, языки, интересы, опыт, локация…',
    };

    const { result, usedHeuristic } = await runDeepAnalysis(
      finalProfile,
      goal,
      history,
      round,
      readBackend(body),
      finalProfile.personModel ?? null,
    );
    if (usedHeuristic) {
      yield {
        type: 'log',
        text: 'ИИ-сервер не ответил — собираю понимание по правилам (запасной режим).',
      };
    }

    const understood = isUnderstood(result, round);
    const forced = round >= MAX_ROUNDS;

    // Строим и сохраняем модель человека — структурную память агента
    // (на основе прежней памяти, если она уже была — ничего не теряем)
    const personModel = finalizePersonModel(finalProfile, goal, result, {
      forced,
      baseModel: finalProfile.personModel,
    });
    const factsCount = personModel.sections.reduce((n, s) => n + s.facts.length, 0);
    yield {
      type: 'log',
      text: `Запомнил о тебе: ${factsCount} фактов, ${personModel.inferences.length} выводов, понимание ${personModel.overallConfidence}%.`,
    };

    const fullText = understood
      ? deepAnalysisToMarkdown(result, finalProfile, { forced })
      : clarifyToMarkdown(result, round);

    // печатаем ответ агента «живым» текстом
    for (const line of fullText.split('\n')) {
      yield { type: 'delta', text: `${line}\n` };
    }

    const directions = (result.directions || [])
      .map((d) => d.name)
      .filter((n): n is string => !!n);

    // сохраняем сообщение агента в историю сессии
    await db.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: fullText.slice(0, 8000),
        meta: JSON.stringify({ kind: 'analysis' }),
      },
    });

    // обновляем профиль и стадию диалога
    try {
      await db.searchSession.update({
        where: { id: sessionId },
        data: {
          stage: understood ? 'ready' : 'analysis',
          profile: JSON.stringify({
            ...finalProfile,
            aiAnalysis: understood ? fullText : finalProfile.aiAnalysis,
            aiDirections: understood ? directions : finalProfile.aiDirections,
            personModel,
            analysisRounds: round + 1,
          }),
        },
      });
      // долговременная память человека: переносится в будущие сессии
      await savePersonMemory({
        model: personModel,
        profile: { ...finalProfile, personModel },
        goal,
      });
    } catch {
      // не критично
    }

    yield { type: 'analysis', text: fullText, directions: understood ? directions : undefined };
    yield { type: 'memory', model: personModel };
    yield {
      type: 'step',
      key: 'understand',
      label: 'Внимательно и глубоко анализирую твою анкету',
      status: 'done',
    };
    if (understood) yield { type: 'ready' };
    yield { type: 'done' };
  }

  return sseResponse(generate());
}
