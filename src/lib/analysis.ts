// Глубокий анализ профиля ПЕРЕД поиском:
// агент внимательно изучает анкету, формирует понимание человека и либо
// говорит «готов начать поиск», либо задаёт уточняющие вопросы в чате.

import { stripDecorativeEmojis } from './emoji';
import { extractJson, llmComplete } from './llm';
import { profileToText } from './prompts';
import { applyAnalysisMemory, buildBasePersonModel, personModelToText, SECTION_DEFS, type ChatMemoryUpdate, type LlmMemoryPayload } from './person-model';
import type { BackendConfig, Goal, PersonModel, UserProfile } from './types';

export interface AnalysisDir {
  name?: string;
  why?: string;
  keywords?: string[];
}

export interface DeepAnalysisResult {
  portrait?: string;
  directions?: AnalysisDir[];
  strengths?: string[];
  constraints?: string[];
  confidence?: number;
  advice?: string;
  questions?: string[];
  understood?: boolean;
  /** структурированная память — что ИИ вывел о человеке по секциям */
  memory?: LlmMemoryPayload;
}

export interface HistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_ROUNDS = 3;

/** Промпт глубокого анализа: профиль + память агента + контекст уточняющего диалога. */
export function deepAnalysisPrompt(
  profile: UserProfile,
  goal: Goal,
  history: HistoryMsg[],
  round: number,
  model?: PersonModel | null,
): string {
  const undecided = profile.decided === false;
  const isAusbildung = goal === 'ausbildung';
  const lastDialog = history
    .slice(-8)
    .map((m) => (m.role === 'assistant' ? `Агент: ${m.content.slice(0, 600)}` : `Человек: ${m.content.slice(0, 600)}`))
    .join('\n');

  return [
    `Ты — Karriere Copilot, карьерный аналитик по ${isAusbildung ? 'Ausbildung (профобучение)' : 'поиску работы'} в Германии.`,
    'Этап: ГЛУБОКИЙ анализ человека ПЕРЕД поиском вакансий. Внимательно, строка за строкой, изучи анкету ниже, чтобы точно понять: кто это, на каком он этапе жизни, что умеет, что для него важно и какие у него ограничения.',
    profile.documents?.length
      ? 'К анкете приложены файлы (Lebenslauf и другие) — их текст включён в анкету ниже. Опирайся на них как на основной источник данных: опыт, образование, навыки, даты. Это сильно повышает качество понимания.'
      : '',
    '',
    'АНКЕТА (заполнена в разговоре с человеком):',
    profileToText(profile),
    model
      ? `ПАМЯТЬ АГЕНТА О ЧЕЛОВЕКЕ (структурированные факты из анкеты, документов и ответов в чате — опирайся на неё и НЕ переспрашивай то, что уже зафиксировано; память обнови под новые ответы):\n${personModelToText(model)}`
      : '',
    '',
    round > 0 && lastDialog
      ? `УТОЧНЯЮЩИЙ ДИАЛОГ (человек уже отвечал на мои вопросы — учти это и НЕ переспрашивай то, на что уже есть ответ):\n${lastDialog}`
      : '',
    'ЗАДАЧА:',
    '0. Пиши серьёзно: НЕ используй эмодзи ни в одном поле ответа.',
    '1. portrait — точный портрет (2–4 предложения), конкретно, без воды.',
    undecided
      ? `2. directions — человек НЕ ОПРЕДЕЛИЛСЯ с профессией. Опираясь на его интересы, любимые предметы, оценки, сильные стороны, языки и локацию, выведи 3–5 КОНКРЕТНЫХ направлений (${isAusbildung ? 'профессий Ausbildung с немецкими названиями' : 'профессий/должностей с немецкими названиями'}), которые ему РЕАЛЬНО подойдут в Германии. Для каждого: почему именно ему + keywords (готовые немецкие поисковые фразы).`
      : `2. directions — человек знает цель. Подтверди её как направление №1 (уточни немецкое название профессии) и добавь 1–3 смежных запасных варианта. Для каждого: почему + keywords (готовые немецкие поисковые фразы).`,
    '3. strengths — 2–4 сильные стороны человека для поиска.',
    '4. constraints — 2–4 ограничения/риска (язык, виза/документы, оценки, дистанция, формат).',
    '5. confidence — 0–100: насколько ты УВЕРЕН, что правильно понял человека. Ставь выше 92 ТОЛЬКО если понятны: цель/направления, уровень языка, образование, локация и право на работу. Если есть пропуски («пропущено») или противоречия — уверенность ниже.',
    `6. questions — если confidence < 92 или что-то важное непонятно: 1–3 КОРОТКИХ уточняющих вопроса для чата (по-человечески, на «ты»). Спрашивай ТОЛЬКО то, что реально меняет стратегию поиска (уровень языка, документы/виза, готовность ездить/переезжать, физические ограничения, точная профессия или приоритет направлений). Если всё ясно — пустой массив.`,
    '7. understood — true только если понял человека на 100% и можно приступать к поиску.',
    `8. memory — СТРУКТУРИРОВАННАЯ ПАМЯТЬ о человеке, которую я сохраню и буду использовать во всех ответах и при поиске. Секции (id): ${SECTION_DEFS.map((s) => `${s.id} (${s.hint})`).join('; ')}.
   — inferences: 2–5 выводов о человеке, которые следуют из анкеты, но прямо в ней не написаны (например «подойдёт работа с низким языковым порогом» — потому что немецкий A2). Для каждого — basis: на чём основан вывод.
   — sectionConfidence: для каждой заполненной или важной секции: id, confidence 0–100 (насколько полно ты её понял), gaps — конкретные пропуски внутри секции (например «неясно, признан ли аттестат другой страны»). НЕ выдумывай факты — память должна быть честной, пусто в секции = так и оставляй.
   — openQuestions: продублируй сюда вопросы из questions — они остаются в памяти открытыми, пока человек не ответит.`,
    '9. Память живёт во времени: факт с пометкой [ДАВНО НЕ ПОДТВЕРЖДАЛОСЬ] — из прошлых сессий, он мог устареть. Если такой факт важен для поиска — добавь мягкий вопрос на подтверждение в questions (например «Ты по-прежнему в Берлине?»). Не переспрашивай всё подряд — только то, что реально влияет на поиск.',
    '',
    'Ответь СТРОГО JSON (без текста вокруг):',
    JSON.stringify({
      portrait: '...',
      directions: [{ name: '...', why: '...', keywords: ['...'] }],
      strengths: ['...'],
      constraints: ['...'],
      confidence: 85,
      questions: [],
      understood: true,
      memory: {
        inferences: [{ text: '...', basis: '...' }],
        sectionConfidence: [{ id: 'education', confidence: 85, gaps: ['...'] }],
        openQuestions: ['...'],
      },
    }),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Учился/получил диплом не (только) в Германии. */
function studiedAbroad(profile: UserProfile): boolean {
  return (
    (!!profile.schoolCountry && profile.schoolCountry !== 'В Германии') ||
    /другой страны/i.test(profile.graduation || '')
  );
}

/** Запасной анализ по правилам — когда ИИ недоступен. Никогда не уточняет. */
export function heuristicDeepAnalysis(profile: UserProfile, goal: Goal): DeepAnalysisResult {
  const isAusbildung = goal === 'ausbildung';
  const bits: string[] = [];
  if (profile.name) bits.push(`${profile.name},`);
  if (profile.age) bits.push(`${profile.age} лет,`);
  if (profile.status) bits.push(`${profile.status.toLowerCase()},`);
  if (profile.graduation)
    bits.push(
      `образование: ${profile.graduation}` +
        (profile.qualification ? ` (${profile.qualification})` : '') +
        (profile.gradeAverage ? `, средний балл ${profile.gradeAverage}` : '') +
        '.',
    );
  else if (profile.qualification) bits.push(`профессия: ${profile.qualification}.`);
  if (profile.germanLevel) bits.push(`Немецкий: ${profile.germanLevel}.`);
  if (profile.experience?.trim()) bits.push(`Есть опыт: ${profile.experience}`);
  const portrait =
    bits.filter(Boolean).join(' ') +
    ` Ищет ${isAusbildung ? 'место Ausbildung' : 'работу'}${
      profile.city
        ? ` в районе ${profile.city}${profile.radius ? ` (радиус ${profile.radius})` : ''}`
        : ' в Германии'
    } (анализ по правилам, без ИИ).`;

  const dirs: AnalysisDir[] = [];
  const push = (name: string, why: string) => {
    if (!dirs.some((d) => d.name === name)) dirs.push({ name, why });
  };

  if (profile.decided === false || !profile.position) {
    const interests = profile.interests || [];
    const subjects = profile.bestSubjects || [];
    const has = (x: string) => interests.includes(x) || subjects.includes(x);
    if (has('Компьютеры и IT') || has('Информатика')) push('Fachinformatiker/in', 'интерес к IT и компьютерам');
    if (has('Техника и машины') || has('Физика')) push('Kfz-Mechatroniker/in', 'любовь к технике и машинам');
    if (has('Медицина и уход') || has('Биология')) push('Pflegefachkraft', 'интерес к медицине и помощи людям');
    if (has('Кулинария и еда')) push('Koch/Köchin', 'интерес к кулинарии');
    if (has('Природа и животные')) push('Tierpfleger/in', 'интерес к животным');
    if (has('Дети и педагогика')) push('Erzieher/in', 'интерес к работе с детьми');
    if (has('Офисная работа и документы') || has('Экономика / бизнес'))
      push('Kaufmann/-frau für Büromanagement', 'склонность к офисной работе и порядку');
    if (has('Творчество и дизайн') || has('Искусство / рисование'))
      push('Mediengestalter/in Digital und Print', 'творческие способности');
    if (has('Продажи и сервис') || has('Люди и общение')) push('Verkäufer/in', 'коммуникабельность и сервис');
    if (has('Транспорт и вождение')) push('Berufskraftfahrer/in', 'интерес к вождению (проверь категории прав)');
    if (has('Физическая / практическая работа') || has('Порядок и организация'))
      push('Fachkraft für Lagerlogistik', 'практическая складская работа — низкий порог входа');
    if (has('Науки и лаборатории') || has('Химия')) push('Chemielaborant/in', 'склонность к естественным наукам');
    if (has('Строительство и ремонт') || has('Ручной труд / техника'))
      push('Anlagenmechaniker/in SHK', 'работа руками в строительстве и ремонте');
    if (has('Ремёсла и работа руками')) push('Tischler/in', 'ремесленная работа руками');
    if (!dirs.length) {
      push(
        'Fachkraft für Lagerlogistik',
        isAusbildung ? 'много учебных мест и низкий порог входа' : 'много вакансий и низкий порог входа',
      );
      push(
        'Verkäufer/in',
        isAusbildung ? 'всегда много мест, прокачивает немецкий' : 'всегда много вакансий, прокачивает немецкий',
      );
      push(
        'Pflegefachkraft',
        isAusbildung ? 'гарантированное место и востребованность' : 'острая нехватка специалистов и востребованность',
      );
    }
  } else if (profile.position) {
    push(profile.position, 'выбранная тобой цель');
  }

  return {
    portrait,
    directions: dirs.slice(0, 5),
    strengths: [
      profile.bestSubjects?.length ? `сильные предметы: ${profile.bestSubjects.join(', ')}` : '',
      profile.skills ? `навыки: ${profile.skills}` : '',
      profile.otherLanguages || profile.germanLevel
        ? `языки: ${[profile.germanLevel, profile.englishLevel, profile.otherLanguages]
            .filter(Boolean)
            .join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .slice(0, 4),
    constraints: [
      profile.workPermit ? `документы: ${profile.workPermit}` : '',
      profile.germanLevel && /A1|A2|Не знаю/i.test(profile.germanLevel)
        ? 'немецкий пока слабый — ищем места с низким языковым порогом или англоязычные'
        : '',
      studiedAbroad(profile) && !/^Признан/i.test(profile.recognition || '')
        ? isAusbildung
          ? 'аттестат другой страны — часть компаний попросит признание (anabin/Zeugnisbewertung)'
          : 'диплом получен не в Германии — для части профессий нужно признание (Anerkennung)'
        : '',
    ]
      .filter(Boolean)
      .slice(0, 4),
    confidence: 60,
    questions: [],
    understood: true,
    advice: 'Запусти поиск — дальше я проверю каждое направление по порталам и скажу честно, что реально подходит.',
  };
}

function clampConfidence(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Вызывает LLM для глубокого анализа; при сбое — эвристика. */
export async function runDeepAnalysis(
  profile: UserProfile,
  goal: Goal,
  history: HistoryMsg[],
  round: number,
  backend?: BackendConfig | null,
  model?: PersonModel | null,
): Promise<{ result: DeepAnalysisResult; usedHeuristic: boolean }> {
  try {
    const res = await llmComplete(
      [
        { role: 'system', content: 'Ты возвращаешь только валидный JSON.' },
        { role: 'user', content: deepAnalysisPrompt(profile, goal, history, round, model) },
      ],
      { backend, temperature: 0.3, maxTokens: 2200 },
    );
    const parsed = extractJson<DeepAnalysisResult>(res.text);
    if (parsed?.portrait && parsed.directions?.some((d) => d.name)) {
      return { result: parsed, usedHeuristic: false };
    }
  } catch {
    // fallback ниже
  }
  return { result: heuristicDeepAnalysis(profile, goal), usedHeuristic: true };
}

/** Решение: понял ли агент человека (с учётом лимита кругов). */
export function isUnderstood(result: DeepAnalysisResult, round: number): boolean {
  const questions = (result.questions || []).filter((q) => typeof q === 'string' && q.trim());
  if (round >= MAX_ROUNDS) return true; // не мучаем человека — принимаем как есть
  // Если агенту есть что спросить — спрашиваем. Если вопросов нет — блокеров нет, готов.
  return questions.length === 0;
}

/** Markdown-сообщение «как я тебя понял + готов начать поиск». */
export function deepAnalysisToMarkdown(
  result: DeepAnalysisResult,
  profile: UserProfile,
  opts: { forced?: boolean; ending?: 'ready' | 'searching' } = {},
): string {
  const undecided = profile.decided === false || (!profile.position && !profile.decided);
  const parts: string[] = [];
  parts.push('### Я внимательно и глубоко изучил твою анкету');
  parts.push('');
  parts.push('Вот как я тебя понял:');
  parts.push('');
  if (result.portrait) parts.push(`**Портрет:** ${stripDecorativeEmojis(result.portrait)}`);
  const dirs = (result.directions || []).filter((d) => d.name);
  if (dirs.length) {
    parts.push('');
    parts.push(
      undecided
        ? '**Направления, которые тебе подойдут** (подобрал по интересам, предметам, оценкам и опыту):'
        : '**Цель и запасные варианты:**',
    );
    dirs.forEach(
      (d, i) =>
        parts.push(
          `${i + 1}. **${stripDecorativeEmojis(d.name ?? '')}**${d.why ? ` — ${stripDecorativeEmojis(d.why)}` : ''}`,
        ),
    );
  }
  if (result.strengths?.length) {
    parts.push('');
    parts.push(`**Сильные стороны:** ${result.strengths.map(stripDecorativeEmojis).join('; ')}`);
  }
  if (result.constraints?.length) {
    parts.push('');
    parts.push(`**На что обращу внимание:** ${result.constraints.map(stripDecorativeEmojis).join('; ')}`);
  }
  const conf = clampConfidence(result.confidence);
  parts.push('');
  parts.push(`**Уверенность, что я понял тебя правильно:** ${conf}%`);
  parts.push(
    `_Всё это я записал в память о тебе — кнопка «Память» в шапке чата покажет, что я знаю и что ещё уточняю._`,
  );
  if (result.advice) {
    parts.push('');
    parts.push(`> ${stripDecorativeEmojis(result.advice)}`);
  }
  parts.push('');
  if (opts.ending === 'searching') {
    parts.push('Теперь я точно понимаю, кого и где искать — приступаю к поиску.');
  } else if (opts.forced) {
    parts.push(
      '**Я собрал полную картину — готов начать поиск!** Жми «Да, начинаем» под этим сообщением и выбирай режим.',
    );
  } else if (conf >= 95) {
    parts.push(
      '**Я понял тебя на 100% — готов начать поиск!** Жми «Да, начинаем» под этим сообщением и выбирай режим: Легкий, Средний или MAX.',
    );
  } else {
    parts.push(
      `**Я понял тебя достаточно хорошо, чтобы искать точно. Готов начать поиск?** Жми «Да, начинаем» под этим сообщением и выбирай режим: Легкий, Средний или MAX. Если хочешь что-то уточнить — просто напиши в чат.`,
    );
  }
  return parts.join('\n');
}

/** Markdown-сообщение с уточняющими вопросами (анализ не завершён). */
export function clarifyToMarkdown(result: DeepAnalysisResult, round: number): string {
  const questions = (result.questions || [])
    .filter((q) => typeof q === 'string' && q.trim())
    .map(stripDecorativeEmojis);
  const parts: string[] = [];
  parts.push('### Хочу уточнить пару моментов');
  parts.push('');
  if (result.portrait) {
    parts.push(stripDecorativeEmojis(result.portrait));
    parts.push('');
  }
  parts.push('Я почти сложил картину, но чтобы искать точно и не тратить твоё время на лишние вакансии, ответь на пару вопросов:');
  parts.push('');
  questions.forEach((q, i) => parts.push(`**${i + 1}.** ${q}`));
  parts.push('');
  parts.push('Отвечай прямо в чате, своими словами — я перепроверю понимание и сразу начну поиск, как только всё станет ясно. Если не знаешь ответ — так и напиши: «не знаю», я учту.');
  if (round >= 2) {
    parts.push('');
    parts.push('_Это последний круг уточнений — после него приму ответы как есть._');
  }
  return parts.join('\n');
}

export { MAX_ROUNDS };

/* ==================== Связка анализа с памятью агента ==================== */

/**
 * Финализирует модель человека после глубокого анализа:
 * базовые факты из анкеты и документов + выводы ИИ, точные уверенности
 * секций и открытые вопросы. Работает даже если ИИ недоступен.
 */
export function finalizePersonModel(
  profile: UserProfile,
  goal: Goal,
  result: DeepAnalysisResult,
  opts: { forced?: boolean; baseModel?: PersonModel } = {},
): PersonModel {
  // Если передана существующая память (прошлые круги анализа, ответы из чата) —
  // строим на её основе, чтобы ничего не забыть; иначе — с нуля из анкеты.
  const base = opts.baseModel ?? buildBasePersonModel(profile, goal);
  // Если ИИ недоступен — создаём простые выводы из результата эвристики,
  // чтобы память всё равно была осмысленной.
  if (!result.memory) {
    result.memory = {
      inferences: (result.directions || [])
        .filter((d) => d.name)
        .slice(0, 4)
        .map((d) => ({
          text: `Подходящее направление: ${d.name}`,
          basis: d.why || 'подобрано по данным анкеты',
        })),
      sectionConfidence: [],
      openQuestions: (result.questions || []).filter((q) => typeof q === 'string' && q.trim()),
    };
  }
  return applyAnalysisMemory(base, result.memory, opts);
}

const MEMORY_UPDATE_SCHEMA = JSON.stringify({
  updates: [
    {
      sectionId: 'languages',
      facts: ['Немецкий: B1 (подтвердил в чате)'],
      resolvedGaps: ['неясен уровень немецкого'],
      corrections: [],
    },
  ],
});

/** Промпт извлечения фактов из ответа человека в чате (обновление памяти). */
export function chatMemoryPrompt(
  message: string,
  profile: UserProfile,
  goal: Goal,
  model: PersonModel,
): string {
  const sections = SECTION_DEFS.map((s) => `${s.id} — ${s.title}`).join('; ');
  return [
    'Ты — Karriere Copilot. Человек только что ответил тебе в чате (он на этапе уточнения профиля перед поиском ' +
      `${goal === 'ausbildung' ? 'Ausbildung' : 'работы'} в Германии).`,
    'Извлеки из его ответа НОВЫЕ факты о нём, чтобы влить их в память о человеке. Не выдумывай: фиксируй только то, что явно сказано или прямо следует.',
    '',
    'ТЕКУЩАЯ ПАМЯТЬ О ЧЕЛОВЕКЕ:',
    model.sections
      .map((s) => `[${s.id}] ${s.facts.map((f) => f.text).join(' | ') || '(пусто)'}`)
      .join('\n'),
    `Открытые вопросы: ${model.openQuestions.join(' | ') || '(нет)'}`,
    '',
    'ОТВЕТ ЧЕЛОВЕКА:',
    message.slice(0, 2000),
    '',
    `Секции: ${sections}.`,
    'Для каждого нового факта укажи sectionId, сам факт — коротко, от третьего лица («Немецкий: B1»).',
    'resolvedGaps — какие из открытых вопросов/пробелов этот ответ закрыл (дословные фрагменты).',
    'corrections — если человек исправил то, что было в памяти (например назвал другой город).',
    'Если ответ — просто «не знаю» или не несёт фактов: updates: [].',
    'НЕ используй эмодзи. Ответь СТРОГО JSON:',
    MEMORY_UPDATE_SCHEMA,
  ].join('\n');
}

/**
 * Извлекает из ответа человека факты для памяти (LLM).
 * Возвращает null, если ИИ недоступен — тогда вызывающий код
 * использует эвристическое слияние (mergeChatAnswer без updates).
 */
export async function extractChatMemoryUpdates(
  message: string,
  profile: UserProfile,
  goal: Goal,
  model: PersonModel,
  backend?: BackendConfig | null,
): Promise<ChatMemoryUpdate[] | null> {
  try {
    const res = await llmComplete(
      [
        { role: 'system', content: 'Ты возвращаешь только валидный JSON.' },
        { role: 'user', content: chatMemoryPrompt(message, profile, goal, model) },
      ],
      { backend, temperature: 0.2, maxTokens: 700 },
    );
    const parsed = extractJson<{ updates?: ChatMemoryUpdate[] }>(res.text);
    if (!parsed) return null;
    const updates = (parsed.updates || []).filter(
      (u) => u && (u.facts?.length || u.resolvedGaps?.length || u.corrections?.length),
    );
    return updates.length ? updates : [];
  } catch {
    return null;
  }
}
