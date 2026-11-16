// Чат с ИИ-агентом: SSE-стриминг ответа.
// Во время стадии «analysis» (уточняющие вопросы после анкеты) агент
// благодарит за ответ, перепроверяет понимание профиля и либо задаёт
// следующий уточняющий вопрос, либо сообщает о готовности к поиску.

import {
  MAX_ROUNDS,
  clarifyToMarkdown,
  deepAnalysisToMarkdown,
  extractChatMemoryUpdates,
  finalizePersonModel,
  isUnderstood,
  runDeepAnalysis,
} from '@/lib/analysis';
import { stripDecorativeEmojis } from '@/lib/emoji';
import { resolveGoal } from '@/lib/goal-sync';
import { buildBasePersonModel, mergeChatAnswer } from '@/lib/person-model';
import { savePersonMemory } from '@/lib/person-store';
import { db } from '@/lib/db';
import { llmStream } from '@/lib/llm';
import { buildChatSystemPrompt, vacancyToFocusText, vacanciesToContext } from '@/lib/prompts';
import { parseIntel } from '@/lib/vacancy-intel';
import { readBackend, sseResponse } from '@/lib/sse';
import type { AgentEvent, Goal, UserProfile } from '@/lib/types';
import type { BackendConfig } from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId: string = body?.sessionId;
  const message: string = typeof body?.message === 'string' ? body.message.trim() : '';
  const vacancyId: string | null = typeof body?.vacancyId === 'string' ? body.vacancyId : null;

  if (!sessionId || !message) {
    return Response.json({ error: 'Нужны sessionId и message' }, { status: 400 });
  }

  const session = await db.searchSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 12 },
      vacancies: { orderBy: [{ score: 'desc' }, { createdAt: 'desc' }], take: 25 },
    },
  });
  if (!session) {
    return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  }

  // Агент всегда знает выбранную цель: если в профиле job/ausbildung — она главная
  const { goal: healedGoal, profile } = await resolveGoal({
    id: session.id,
    goal: session.goal,
    title: session.title,
    profile: session.profile,
  });
  const goal: Goal = healedGoal;
  const stage = session.stage || 'chat';
  const focus = vacancyId ? session.vacancies.find((v) => v.id === vacancyId) : null;

  // Сохраняем сообщение пользователя сразу
  await db.message.create({
    data: { sessionId, role: 'user', content: message.slice(0, 6000) },
  });

  const history = [...session.messages].reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, 4000),
  }));

  /* ---------- Стадия «analysis»: ответ на уточняющие вопросы ---------- */
  if (stage === 'analysis' && profile) {
    return sseResponse(
      analysisFollowUp(sessionId, profile, goal, message, history, readBackend(body)),
    );
  }

  /* ---------- Обычный чат ---------- */
  const system = buildChatSystemPrompt({
    profile,
    goal,
    stage: stage as 'wizard' | 'analysis' | 'ready' | 'chat',
    vacanciesSummary: vacanciesToContext(session.vacancies),
    focusVacancy: focus
      ? vacancyToFocusText({
          title: focus.title,
          company: focus.company,
          location: focus.location,
          url: focus.url,
          salary: focus.salary,
          description: focus.description,
          snippet: focus.snippet,
          score: focus.score,
          verdict: focus.verdict,
          reasons: focus.reasons ? safeArr(focus.reasons) : null,
          risks: focus.risks ? safeArr(focus.risks) : null,
          source: focus.source,
          intel: parseIntel((focus as { intel?: string | null }).intel),
        })
      : null,
  });

  const llmMessages = [
    { role: 'system' as const, content: system },
    ...history,
    { role: 'user' as const, content: message },
  ];

  async function* generate(): AsyncGenerator<AgentEvent> {
    let full = '';
    let fallbackNote: string | undefined;
    for await (const chunk of llmStream(llmMessages, { backend: readBackend(body) })) {
      if (chunk.fallbackNote) {
        fallbackNote = chunk.fallbackNote;
        yield { type: 'backend', note: fallbackNote };
      }
      if (chunk.delta) {
        full += chunk.delta;
        yield { type: 'delta', text: chunk.delta };
      }
    }
    if (!full.trim()) {
      full = 'Извини, не удалось получить ответ от ИИ. Попробуй ещё раз или проверь настройки ИИ (кнопка «ИИ-сервер» слева внизу).';
      yield { type: 'delta', text: full };
    }
    const clean = stripDecorativeEmojis(full);
    await db.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: clean.slice(0, 8000),
        meta: fallbackNote ? JSON.stringify({ note: fallbackNote }) : null,
      },
    });
    yield { type: 'done' };
  }

  return sseResponse(generate());
}

/* ------------------- Цикл уточняющих вопросов ------------------- */

const ACKS = [
  'Спасибо, записал.',
  'Принял, спасибо.',
  'Запомню, спасибо.',
  'Отлично, это важно — учту.',
];

async function* analysisFollowUp(
  sessionId: string,
  profile: UserProfile,
  goal: Goal,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  backend: BackendConfig | null,
): AsyncGenerator<AgentEvent> {
  const round = Math.max(0, Math.min(Number(profile.analysisRounds) || 0, MAX_ROUNDS));
  const ack = ACKS[message.length % ACKS.length];

  // короткое подтверждение + индикатор перепроверки
  yield { type: 'delta', text: ack };
  yield { type: 'delta', text: '\n\n' };
  yield {
    type: 'step',
    key: 'understand',
    label: 'Перепроверяю, как я тебя понял',
    status: 'active',
  };

  const dialog = [...history, { role: 'user' as const, content: message }];

  /* --- 1) Память: вливаем ответ человека в модель, чтобы не забыть --- */
  const baseModel = profile.personModel ?? buildBasePersonModel(profile, goal);
  const updates = await extractChatMemoryUpdates(message, profile, goal, baseModel, backend);
  const mergedModel = mergeChatAnswer(baseModel, message, updates ?? undefined);
  const newFacts =
    mergedModel.sections.reduce((n, s) => n + s.facts.length, 0) -
    baseModel.sections.reduce((n, s) => n + s.facts.length, 0);
  const closedGaps = Math.max(
    0,
    baseModel.openQuestions.length - mergedModel.openQuestions.length,
  );
  if (newFacts > 0 || closedGaps > 0) {
    yield {
      type: 'log',
      text: `Записал в память: ${newFacts > 0 ? `+${newFacts} факт(ов)` : ''}${newFacts > 0 && closedGaps > 0 ? ', ' : ''}${closedGaps > 0 ? `${closedGaps} вопрос(ов) закрыт(ы)` : ''}`,
    };
  }

  /* --- 2) Перепроверка понимания с учётом обновлённой памяти --- */
  const { result, usedHeuristic } = await runDeepAnalysis(
    profile,
    goal,
    dialog,
    round,
    backend,
    mergedModel,
  );
  if (usedHeuristic) {
    yield {
      type: 'log',
      text: 'ИИ-сервер не ответил — собираю понимание по правилам (запасной режим).',
    };
  }

  const understood = isUnderstood(result, round);
  const forced = round >= MAX_ROUNDS;

  // Обогащаем память результатами перепроверки (выводы, уверенности, пробелы)
  const personModel = finalizePersonModel(profile, goal, result, {
    forced,
    baseModel: mergedModel,
  });

  const fullText = understood
    ? deepAnalysisToMarkdown(result, profile, { forced })
    : clarifyToMarkdown(result, round);

  for (const line of fullText.split('\n')) {
    yield { type: 'delta', text: `${line}\n` };
  }

  const combined = `${ack}\n\n${fullText}`;
  await db.message.create({
    data: {
      sessionId,
      role: 'assistant',
      content: combined.slice(0, 8000),
      meta: JSON.stringify({ kind: 'analysis' }),
    },
  });

  const directions = (result.directions || [])
    .map((d) => d.name)
    .filter((n): n is string => !!n);

  try {
    await db.searchSession.update({
      where: { id: sessionId },
      data: {
        stage: understood ? 'ready' : 'analysis',
        profile: JSON.stringify({
          ...profile,
          aiAnalysis: understood ? fullText : profile.aiAnalysis,
          aiDirections: understood ? directions : profile.aiDirections,
          personModel,
          analysisRounds: round + 1,
        }),
      },
    });
    // долговременная память человека: переносится в будущие сессии
    await savePersonMemory({
      model: personModel,
      profile: { ...profile, personModel },
      goal,
    });
  } catch {
    // не критично
  }

  yield { type: 'memory', model: personModel };

  yield {
    type: 'step',
    key: 'understand',
    label: 'Перепроверяю, как я тебя понял',
    status: 'done',
  };
  if (understood) yield { type: 'ready' };
  yield { type: 'done' };
}

function safeArr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
