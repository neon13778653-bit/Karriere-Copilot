// Смоук-тест анкеты (profile-wizard), запасного анализа без ИИ и эмодзи-политики.
// Запуск: bun scripts/wizard-smoke.ts  (или npx tsx scripts/wizard-smoke.ts)

import {
  applyAnswer,
  applySkip,
  buildWizardQuestions,
  finalizeProfile,
  isAnswered,
  prefillFromProfile,
  visibleQuestions,
  DOCUMENTS_STAGE,
  WIZARD_STAGE_COUNT,
  wizardStages,
} from '../src/lib/profile-wizard';
import { profileToText } from '../src/lib/prompts';
import { heuristicDeepAnalysis, isUnderstood, MAX_ROUNDS } from '../src/lib/analysis';
import { stripDecorativeEmojis } from '../src/lib/emoji';
import type { Goal, UserProfile } from '../src/lib/types';

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

const GOALS: Goal[] = ['ausbildung', 'job'];

// Вопросы, где слово «работа» / «Ausbildung» законно в обоих режимах (статус человека, право на работу).
const WORK_WORD_OK = new Set(['status', 'otherLanguages', 'workPermit']);

for (const goal of GOALS) {
  const qs = buildWizardQuestions(goal);

  check(`[${goal}] id вопросов уникальны`, new Set(qs.map((q) => q.id)).size === qs.length);

  // «Не определился везде»: пропустить можно любой вопрос, кроме ключевого выбора decided
  const noSkip = qs.filter((q) => !q.skipLabel && !q.skipValue).map((q) => q.id);
  check(`[${goal}] пропуск есть у всех вопросов, кроме decided`, noSkip.length === 1 && noSkip[0] === 'decided', noSkip.join(','));

  // Пропуск реально засчитывает вопрос как отвеченный
  let p: UserProfile = { goal, decided: false };
  for (const q of visibleQuestions(goal, p)) p = applySkip(goal, p, q);
  const stillOpen = visibleQuestions(goal, p).filter((q) => !isAnswered(q, p)).map((q) => q.id);
  check(`[${goal}] после пропуска всех вопросов открытых нет`, stillOpen.length === 0, stillOpen.join(','));

  // Режимозависимость формулировок
  const leaks: string[] = [];
  for (const q of qs) {
    const text = [q.label, q.question, q.hint].filter(Boolean).join(' ');
    if (goal === 'ausbildung' && !WORK_WORD_OK.has(q.id) && /(?<![а-яё])работ/i.test(text)) leaks.push(q.id);
    if (goal === 'job' && /Ausbildung/i.test(text)) leaks.push(q.id);
  }
  check(`[${goal}] тексты вопросов не смешивают режимы`, leaks.length === 0, leaks.join(','));

  // Эмодзи в тексте анкеты запрещены
  const dirty = qs.filter((q) => {
    const all = [q.label, q.question, q.hint, ...(q.options || []), ...(q.examples || [])].filter(Boolean).join(' ');
    return stripDecorativeEmojis(all) !== all;
  });
  check(`[${goal}] в анкете нет эмодзи`, dirty.length === 0, dirty.map((q) => q.id).join(','));
}

// Две анкеты — действительно разные, а не одна с подменой слов
{
  const aus = buildWizardQuestions('ausbildung');
  const job = buildWizardQuestions('job');
  const ids = (qs: typeof aus) => new Set(qs.map((q) => q.id));
  const A = ids(aus);
  const J = ids(job);

  const ausOnly = ['weakSubjects', 'tryout'];
  const jobOnly = ['qualification', 'seniority', 'germanyExperience', 'avoid', 'contract'];
  const ausNotInJob = ['schoolType', 'gradeAverage', 'bestSubjects', ...ausOnly];
  check('Ausbildung: есть вопросы про школу, тяжёлые предметы и пробный день/EQ', ['schoolType', 'gradeAverage', 'bestSubjects', ...ausOnly].every((id) => A.has(id)));
  check('Ausbildung: нет рабочих вопросов (уровень позиции, договор, чего избегать…)', jobOnly.every((id) => !A.has(id)));
  check('Работа: есть профессия по диплому, уровень, опыт в Германии, договор, чего избегать', jobOnly.every((id) => J.has(id)));
  check('Работа: нет школьных вопросов (тип школы, балл, предметы, EQ)', ausNotInJob.every((id) => !J.has(id)));

  const titlesA = wizardStages('ausbildung').map((s) => s.title).join('|');
  const titlesJ = wizardStages('job').map((s) => s.title).join('|');
  check('названия этапов у режимов разные', titlesA !== titlesJ);
  check(`в каждой анкете ${WIZARD_STAGE_COUNT} этапов, у каждого есть подзаголовок`, [wizardStages('ausbildung'), wizardStages('job')].every((st) => st.length === WIZARD_STAGE_COUNT && st.every((x) => x.title && x.subtitle)));
  check('все вопросы привязаны к существующим этапам (до «Документов»)', [...aus, ...job].every((q) => q.stageIdx >= 0 && q.stageIdx < DOCUMENTS_STAGE));
  const leakSub = [wizardStages('ausbildung'), wizardStages('job')].flatMap((st, i) => st.filter((x) => (i === 1 ? /Ausbildung/i.test(x.subtitle) : /(?<![а-яё])работ/i.test(x.subtitle) && !/право/i.test(x.title)))).map((x) => x.title);
  check('подзаголовки этапов не смешивают режимы', leakSub.length === 0, leakSub.join(','));

  // Свободный чат: до выбора цели только вопрос о цели
  const chat = buildWizardQuestions('chat');
  check('чат: до выбора цели только вопрос о цели', chat.length === 1 && chat[0].id === 'goalPick');

  // Признание диплома/аттестата — только если учился не в Германии
  for (const goal of GOALS) {
    const de = visibleQuestions(goal, { goal, schoolCountry: 'В Германии' }).some((q) => q.id === 'recognition');
    const abroad = visibleQuestions(goal, { goal, schoolCountry: 'В другой стране' }).some((q) => q.id === 'recognition');
    const unknown = visibleQuestions(goal, { goal }).some((q) => q.id === 'recognition');
    check(`[${goal}] признание показывается только при учёбе вне Германии`, !de && abroad && !unknown);
  }
  const fin = finalizeProfile('job', { goal: 'job', schoolCountry: 'В Германии', recognition: 'Признан полностью' });
  check('finalize: признание удаляется, если образование из Германии', fin.recognition === undefined);

  // Подписи для ИИ тоже зависят от режима
  const tA = profileToText({ goal: 'ausbildung', salary: '1000', format: 'Любая', startDate: 'Как можно скорее', workPermit: 'Гражданство ЕС / ПМЖ' });
  const tJ = profileToText({ goal: 'job', salary: '14 €/час', format: 'Любой', startDate: 'Сразу', contract: 'Любой', workPermit: 'Гражданство ЕС' });
  check('profileToText (Ausbildung): Vergütung, вид обучения, статус проживания', /Ausbildungsvergütung/.test(tA) && /Вид обучения/.test(tA) && /Статус проживания/.test(tA) && !/Формат работы/.test(tA));
  check('profileToText (работа): доход, формат работы, договор, право на работу', /Ожидания по доходу/.test(tJ) && /Формат работы/.test(tJ) && /Тип договора/.test(tJ) && /Право на работу/.test(tJ) && !/Ausbildungsvergütung/.test(tJ));

  // Перенос данных между сессиями разных режимов
  const prevAus: UserProfile = {
    goal: 'ausbildung',
    name: 'Анна',
    schoolCountry: 'В другой стране',
    graduation: 'Abitur', // вариант анкеты Ausbildung, в анкете работы такого нет
    weakSubjects: ['Физика'],
    germanLevel: 'B1',
    format: 'Дуальная: в компании + Berufsschule',
    startDate: 'Как можно скорее',
    salary: 'От 1000 € в месяц',
    city: 'Дортмунд',
  };
  const toJob = prefillFromProfile(prevAus, 'job');
  check('перенос Ausbildung → работа: имя, страна, немецкий, город переносятся', toJob.name === 'Анна' && toJob.schoolCountry === 'В другой стране' && toJob.germanLevel === 'B1' && toJob.city === 'Дортмунд');
  check('перенос Ausbildung → работа: чужие варианты и вопросы не переносятся', toJob.graduation === undefined && toJob.weakSubjects === undefined && toJob.format === undefined);
  check('перенос: старт и доход всегда спрашиваются заново', toJob.startDate === undefined && toJob.salary === undefined);
  const prevJob: UserProfile = { goal: 'job', germanLevel: 'B2', qualification: 'электрик', graduation: 'Немецкая Berufsausbildung', seniority: 'Квалифицированный специалист (Fachkraft)', city: 'Берлин' };
  const toAus = prefillFromProfile(prevJob, 'ausbildung');
  check('перенос работа → Ausbildung: язык и город переносятся, рабочие поля — нет', toAus.germanLevel === 'B2' && toAus.city === 'Берлин' && toAus.qualification === undefined && toAus.graduation === undefined && toAus.seniority === undefined);
}

// decided: смена ветки чистит поля противоположной
{
  const goal: Goal = 'ausbildung';
  const decidedQ = buildWizardQuestions(goal).find((q) => q.id === 'decided')!;
  let p: UserProfile = { goal, interests: ['Компьютеры и IT'], strengths: 'логика', position: 'Fachinformatiker' };
  p = applyAnswer(goal, p, decidedQ, decidedQ.options![0]);
  const decidedNow = p.decided;
  const branchName = decidedNow ? 'знаю профессию' : 'не определился';
  if (decidedNow === true) check('decided=да удаляет интересы и сильные стороны', !p.interests && !p.strengths && p.position === 'Fachinformatiker', branchName);
  else check('decided=нет удаляет position', !p.position && !!p.interests, branchName);
  const other = decidedQ.options!.find((o) => o !== decidedQ.options![0])!;
  const p2 = applyAnswer(goal, { ...p, interests: ['IT'], position: 'X' }, decidedQ, other);
  check('смена ветки decided работает в обе стороны', p2.decided !== decidedNow);
}

// finalizeProfile
{
  const raw: UserProfile = {
    goal: 'chat',
    decided: false,
    position: 'Старая позиция',
    strengths: ' аккуратность ',
    name: '  ',
    aiAnalysis: 'старый анализ',
    analysisRounds: 2,
    interests: [],
  };
  const f = finalizeProfile('ausbildung', raw);
  check('finalize: goal из чата заменяется выбранным', f.goal === 'ausbildung');
  check('finalize: при «не определился» position сбрасывается, strengths чистятся', f.position === undefined && f.strengths === 'аккуратность');
  check('finalize: пустые строки и массивы убираются', f.name === undefined && f.interests === undefined);
  check('finalize: прошлый анализ сбрасывается', f.aiAnalysis === undefined && f.analysisRounds === 0);
}

// Запасной анализ без ИИ
{
  const profile: UserProfile = {
    goal: 'ausbildung',
    decided: false,
    interests: ['Компьютеры и IT'],
    bestSubjects: ['Информатика', 'Математика'],
    graduation: 'Realschulabschluss',
    germanLevel: 'B1',
    city: 'Дортмунд',
  };
  const rich = heuristicDeepAnalysis(
    { ...profile, interests: ['Компьютеры и IT', 'Техника и машины', 'Творчество и дизайн'] },
    'ausbildung',
  );
  const dirs = rich.directions || [];
  check('эвристика: 3–5 направлений по нескольким интересам', dirs.length >= 3 && dirs.length <= 5, `${dirs.length}`);
  check('эвристика: у каждого направления есть название и обоснование', dirs.every((d) => d.name && d.why));
  const r = heuristicDeepAnalysis(profile, 'ausbildung');
  const none = heuristicDeepAnalysis({ goal: 'job', decided: false }, 'job');
  check(
    'эвристика: без интересов — 3 запасных направления, в режиме job без «учебных мест»',
    (none.directions || []).length === 3 && !(none.directions || []).some((d) => /учебн/i.test(d.why || '')),
  );
  check('эвристика: уверенность умеренная (<92) — агент уточнит', (r.confidence ?? 0) > 0 && (r.confidence ?? 0) < 92, `${r.confidence}`);
  check('эвристика: портрет без эмодзи', stripDecorativeEmojis(r.portrait || '') === (r.portrait || ''));

  const foreignJob = heuristicDeepAnalysis({ goal: 'job', decided: true, position: 'Электрик', schoolCountry: 'В другой стране', recognition: 'Не подавал(а) — нужна помощь' }, 'job');
  check('эвристика (работа): диплом не из Германии без признания → ограничение про Anerkennung', (foreignJob.constraints || []).some((c) => /Anerkennung/.test(c)));
  const recognizedJob = heuristicDeepAnalysis({ goal: 'job', decided: true, position: 'Электрик', schoolCountry: 'В другой стране', recognition: 'Признан полностью' }, 'job');
  check('эвристика (работа): признанный диплом ограничением не считается', !(recognizedJob.constraints || []).some((c) => /Anerkennung/.test(c)));

  const rJob = heuristicDeepAnalysis({ goal: 'job', decided: true, position: 'Fachinformatiker', germanLevel: 'B2' }, 'job');
  check('эвристика: для job портрет про работу, а не Ausbildung', /работ/i.test(rJob.portrait || '') && !/Ausbildung/i.test(rJob.portrait || ''));
}

// Правила «понял / не понял»
{
  check('isUnderstood: нет вопросов — понял', isUnderstood({ questions: [] }, 0));
  check('isUnderstood: есть вопрос — ещё нет', !isUnderstood({ questions: ['Какой у тебя уровень немецкого?'] }, 0));
  check(`isUnderstood: после ${MAX_ROUNDS} кругов принимаем как есть`, isUnderstood({ questions: ['ещё вопрос'] }, MAX_ROUNDS));
}

// Эмодзи-политика
{
  const dirty = 'Привет 👋 Это 🔥 важно ⚡ и 📍 тут ⚖️ вот 🎯 так 👤 ок';
  const clean = stripDecorativeEmojis(dirty);
  check('emoji: все декоративные эмодзи удалены', !/[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/u.test(clean), JSON.stringify(clean));
  check('emoji: обычный текст, цифры и № не портятся', stripDecorativeEmojis('Пункт 1: B2, №5 — ok (2026)') === 'Пункт 1: B2, №5 — ok (2026)');
}

console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ АНКЕТЫ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);
