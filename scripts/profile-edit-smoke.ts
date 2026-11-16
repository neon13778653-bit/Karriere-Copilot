// Смоук-тест гибкого профиля: сброс ответа, свои разделы, подсчёт изменений, правка без пересчёта.
// Запуск: bun scripts/profile-edit-smoke.ts  (или npx tsx scripts/profile-edit-smoke.ts)

import {
  CUSTOM_LIMITS,
  customFieldLines,
  customFilledCount,
  normalizeCustomSections,
} from '../src/lib/custom-sections';
import { buildBasePersonModel, refreshAnketaFacts } from '../src/lib/person-model';
import { profileToText } from '../src/lib/prompts';
import {
  applyAnswer,
  applyClear,
  applySkip,
  buildWizardQuestions,
  finalizeProfile,
  isAnswered,
  profileChanges,
} from '../src/lib/profile-wizard';
import type { CustomSection, UserProfile } from '../src/lib/types';

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

const q = (goal: 'job' | 'ausbildung', id: string) => buildWizardQuestions(goal).find((x) => x.id === id)!;

// ---------- Сброс ответа ----------
{
  const city = q('job', 'city');
  let p: UserProfile = applyAnswer('job', { goal: 'job' }, city, 'Берлин');
  check('ответ сохранён', isAnswered(city, p));
  p = applyClear(p, city);
  check('сброс: вопрос снова не отвечен', !isAnswered(city, p) && p.city === undefined);

  p = applySkip('job', { goal: 'job' }, city);
  check('пропуск засчитывается как ответ', isAnswered(city, p));
  p = applyClear(p, city);
  check('сброс снимает и отметку «пропущено»', !isAnswered(city, p) && !(p.wizardSkipped ?? []).includes('city'));

  const decided = q('job', 'decided');
  let d: UserProfile = applyAnswer('job', { goal: 'job' }, decided, decided.options![0]);
  d = { ...d, position: 'Электрик' };
  const cleared = applyClear(d, decided);
  check('сброс «знаю профессию» снимает и выбор, и должность', cleared.decided === undefined && cleared.position === undefined);

  const before = { goal: 'job' as const, city: 'Köln', wizardSkipped: ['name'] };
  const after = applyClear(before, city);
  check('сброс не мутирует прежний профиль', before.city === 'Köln' && before.wizardSkipped.length === 1 && after !== before);
}

// ---------- Свои разделы: нормализация ----------
{
  check('не массив → undefined', normalizeCustomSections('x') === undefined && normalizeCustomSections(null) === undefined);

  const many = Array.from({ length: 12 }, (_, i) => ({
    id: 'same',
    title: 'Раздел ' + i,
    fields: Array.from({ length: 30 }, (_, j) => ({ id: 'f', label: 'L' + j, value: 'x'.repeat(5000) })),
  }));
  const n = normalizeCustomSections(many)!;
  check(`лимит разделов (${CUSTOM_LIMITS.sections})`, n.length === CUSTOM_LIMITS.sections);
  check(`лимит полей (${CUSTOM_LIMITS.fieldsPerSection}) и длины значения`, n[0].fields.length === CUSTOM_LIMITS.fieldsPerSection && n[0].fields[0].value.length === CUSTOM_LIMITS.value);
  check('id разделов и полей уникальны', new Set(n.map((s) => s.id)).size === n.length && new Set(n[0].fields.map((f) => f.id)).size === n[0].fields.length);

  const junk = normalizeCustomSections([null, 5, { title: 7, fields: 'x' }, { title: 'Ок', fields: [null, { label: 3, value: null }, { label: 'a', value: 'b' }] }])!;
  check('мусор во входных данных не ломает нормализацию', Array.isArray(junk) && junk.some((s) => s.title === 'Ок'));

  const draft: CustomSection[] = [{ id: 's', title: 'Ссылки', fields: [{ id: 'f1', label: 'GitHub', value: '' }] }];
  check('при наборе пустые поля сохраняются', normalizeCustomSections(draft)![0].fields.length === 1);
  check('при отправке агенту пустое выбрасывается', normalizeCustomSections(draft, { dropEmpty: true }) === undefined);

  const filled: CustomSection[] = [
    { id: 's', title: ' Ссылки ', fields: [{ id: 'a', label: ' GitHub ', value: ' github.com/x ' }, { id: 'b', label: 'Сайт', value: '  ' }] },
  ];
  check('строки для ИИ: «Раздел — Поле: значение», пустые пропущены', JSON.stringify(customFieldLines(filled)) === JSON.stringify(['Ссылки — GitHub: github.com/x']));
  check('счётчик заполненных полей', customFilledCount(filled) === 1 && customFilledCount(undefined) === 0);
}

// ---------- Финализация без сброса анализа ----------
{
  const p: UserProfile = {
    goal: 'job',
    decided: true,
    position: 'Электрик',
    city: 'Берлин',
    aiAnalysis: 'портрет',
    analysisRounds: 2,
    customSections: [
      { id: 's1', title: 'Ссылки', fields: [{ id: 'f', label: 'GitHub', value: 'github.com/x' }, { id: 'g', label: 'пусто', value: '' }] },
      { id: 's2', title: 'Пустой', fields: [{ id: 'h', label: '', value: '' }] },
    ],
  };
  const keep = finalizeProfile('job', p, { keepAnalysis: true });
  const reset = finalizeProfile('job', p);
  check('keepAnalysis сохраняет прежний анализ', keep.aiAnalysis === 'портрет' && keep.analysisRounds === 2);
  check('по умолчанию анализ сбрасывается', reset.aiAnalysis === undefined && reset.analysisRounds === 0);
  check('finalize: пустые поля и пустые разделы убираются', keep.customSections?.length === 1 && keep.customSections[0].fields.length === 1);
}

// ---------- Что изменилось ----------
{
  const base: UserProfile = { goal: 'job', name: 'Анна', city: 'Берлин', germanLevel: 'B1', wizardSkipped: ['age'] };
  const same = profileChanges('job', base, { ...base });
  check('без правок изменений нет', same.changes.length === 0 && !same.needsReanalysis);

  const name = profileChanges('job', base, { ...base, name: 'Анна-Мария' });
  check('смена имени — правка, но пересчёт не нужен', name.changes.length === 1 && name.changes[0].id === 'name' && !name.needsReanalysis);

  const city = profileChanges('job', base, { ...base, city: 'Кёльн' });
  check('смена города требует пересчёта и показывает «было»', city.needsReanalysis && city.changes[0].before === 'Берлин' && city.changes[0].after === 'Кёльн');

  const skipChange = profileChanges('job', base, { ...base, wizardSkipped: [] });
  check('снятие пропуска тоже считается изменением', skipChange.changes.some((c) => c.id === 'age'));

  const custom = profileChanges('job', base, {
    ...base,
    customSections: [{ id: 's', title: 'Ссылки', fields: [{ id: 'f', label: 'GitHub', value: 'x' }] }],
  });
  check('свои разделы учитываются в изменениях', custom.changes.some((c) => c.id === 'customSections') && custom.needsReanalysis);

  const fromNull = profileChanges('job', null, { goal: 'job', city: 'Ульм' });
  check('без снимка сравнение с пустым профилем не падает', fromNull.changes.length === 1);
}

// ---------- Свои разделы в тексте для ИИ и в памяти ----------
{
  const p: UserProfile = {
    goal: 'job',
    name: 'Анна',
    city: 'Берлин',
    customSections: [{ id: 's', title: 'Ссылки', fields: [{ id: 'f', label: 'GitHub', value: 'github.com/anna' }] }],
  };
  check('profileToText содержит свои разделы', /СВОИ РАЗДЕЛЫ/.test(profileToText(p)) && /Ссылки — GitHub: github\.com\/anna/.test(profileToText(p)));

  const base = buildBasePersonModel(p, 'job');
  const motivation = base.sections.find((s) => s.id === 'motivation')!;
  check('свои поля попадают в память (секция «Мотивация и характер»)', motivation.facts.some((f) => f.text.includes('github.com/anna') && f.source === 'Анкета'));
}

// ---------- Обновление памяти без пересчёта анализа ----------
{
  const p1: UserProfile = { goal: 'job', name: 'Анна', city: 'Берлин', germanLevel: 'B1' };
  const m1 = buildBasePersonModel(p1, 'job');
  const dir = m1.sections.find((s) => s.id === 'direction')!;
  const seed = m1.sections.flatMap((s) => s.facts)[0];
  dir.facts.push({ ...seed, id: 'chat-1', text: 'Хочет только дневные смены', source: 'Чат' });
  dir.facts.push({ ...seed, id: 'ai-1', text: 'Склонна к работе с людьми', source: 'Анализ' });
  const cityFactBefore = m1.sections.flatMap((s) => s.facts).find((f) => f.text.includes('Берлин'))!;
  cityFactBefore.confirmedAt = '2026-01-01T00:00:00.000Z';
  const journalBefore = m1.journal.length;

  const p2: UserProfile = { ...p1, city: 'Кёльн', germanLevel: 'B1', customSections: [{ id: 's', title: 'Ссылки', fields: [{ id: 'f', label: 'Сайт', value: 'anna.dev' }] }] };
  const m2 = refreshAnketaFacts(m1, p2, 'job');
  const all = m2.sections.flatMap((s) => s.facts);

  check('память: вывод из чата сохранён', all.some((f) => f.text === 'Хочет только дневные смены'));
  check('память: вывод ИИ сохранён', all.some((f) => f.text === 'Склонна к работе с людьми'));
  check('память: изменённый ответ обновлён', all.some((f) => f.text.includes('Кёльн')) && !all.some((f) => f.text.includes('Берлин')));
  check('память: новое своё поле добавлено', all.some((f) => f.text.includes('anna.dev')));
  const lang = all.find((f) => f.text.includes('B1'))!;
  const langBefore = m1.sections.flatMap((s) => s.facts).find((f) => f.text.includes('B1'))!;
  check('память: неизменённый факт остался тем же (время сохранено)', lang.at === langBefore.at);
  check('память: журнал пополнился записями об обновлении', m2.journal.length > journalBefore && m2.journal.some((j) => /Обновлено в профиле/.test(j.text)) && m2.journal.some((j) => /Больше не актуально/.test(j.text)));
  check('память: исходная модель не изменена (чистая функция)', m1.sections.flatMap((s) => s.facts).some((f) => f.text.includes('Берлин')));

  const none = refreshAnketaFacts(undefined, p2, 'job');
  check('память: без прежней модели строится базовая', none.sections.flatMap((s) => s.facts).some((f) => f.text.includes('Кёльн')));
}

console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ ГИБКОГО ПРОФИЛЯ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);
