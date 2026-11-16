// Смоук-тест системы памяти: базовое извлечение, слияние из чата, дедупликация,
// полураспад доверия, забывание по времени, архив и восстановление.
import {
  buildBasePersonModel,
  mergeChatAnswer,
  personModelToText,
  applyAnalysisMemory,
} from '../src/lib/person-model';
import {
  confirmFact,
  factEffective,
  factStatusCounts,
  forgetFactNow,
  purgeFact,
  restoreFact,
  sweepMemory,
} from '../src/lib/memory-decay';
import type { Goal, MemoryFact, PersonModel, UserProfile } from '../src/lib/types';

const profile: UserProfile = {
  goal: 'ausbildung',
  name: 'Иван',
  age: '17',
  status: 'Закончил школу',
  graduation: 'Realschulabschluss',
  gradeAverage: '2,4',
  bestSubjects: ['Информатика', 'Математика'],
  germanLevel: 'B1',
  decided: false,
  interests: ['Компьютеры и IT'],
  city: 'Дортмунд',
  radius: '+25 км',
  documents: [
    { id: 'd1', name: 'Lebenslauf.pdf', mime: 'pdf', size: 48_000, chars: 3200, text: '...', addedAt: new Date().toISOString() },
  ],
};

const goal: Goal = 'ausbildung';

// 1) Базовая модель
let model = buildBasePersonModel(profile, goal);
const facts0 = model.sections.reduce((n, s) => n + s.facts.length, 0);
console.log('Базовая модель: фактов =', facts0, '| выводов =', model.inferences.length, '| журнал =', model.journal.length, '| общее понимание =', model.overallConfidence + '%');
if (facts0 < 6) throw new Error('Слишком мало фактов извлечено');
const edu = model.sections.find((s) => s.id === 'education');
if (!edu?.facts.some((f) => f.text.includes('Realschulabschluss'))) throw new Error('Образование не извлечено');
if (!edu.facts.some((f) => f.text.includes('2,4'))) throw new Error('Средний балл не извлечён');
const docs = model.sections.flatMap((s) => s.facts).filter((f) => f.source === 'Файл: Lebenslauf.pdf');
if (!docs.length) throw new Error('Документ не попал в память');

// 2) Обогащение от анализа ИИ
model = applyAnalysisMemory(model, {
  inferences: [
    { text: 'Подойдёт направление Fachinformatiker', basis: 'интерес к IT и лучший предмет информатика' },
    { text: 'Подойдёт направление Fachinformatiker', basis: 'дубликат — не должен попасть' },
  ],
  sectionConfidence: [{ id: 'education', confidence: 90, gaps: ['неясно, признан ли аттестат'] }],
  openQuestions: ['Признание аттестата нужно проверять?'],
});
const dup = model.inferences.filter((i) => i.text.includes('Fachinformatiker')).length;
console.log('После анализа: выводов =', model.inferences.length, '| дубликатов =', dup === 1 ? 0 : dup);
if (dup !== 1) throw new Error('Дедупликация выводов не работает');

// 3) Ответ в чате вливается в память
const before = model.sections.reduce((n, s) => n + s.facts.length, 0);
const qCount0 = model.openQuestions.length;
model = mergeChatAnswer(model, 'Мой аттестат уже признан, я проверял в anabin. Немецкий подтянул до B2.', [
  { sectionId: 'documents', facts: ['Аттестат признан (проверено в anabin)'], resolvedGaps: ['признан ли аттестат'] },
  { sectionId: 'languages', facts: ['Немецкий: B2 (подтвердил в чате)'] },
]);
const after = model.sections.reduce((n, s) => n + s.facts.length, 0);
const germanFacts = model.sections
  .find((s) => s.id === 'languages')!
  .facts.filter((f) => f.text.toLowerCase().startsWith('немецкий'));
const clarified = model.journal.filter((j) => j.text.startsWith('Уточнил:'));
console.log('После ответа в чате: фактов', before, '→', after, '(B1 вытеснен B2) | немецких фактов =', germanFacts.length, '| уточнений в журнале =', clarified.length, '| открытых вопросов', qCount0, '→', model.openQuestions.length);
if (germanFacts.length !== 1 || !germanFacts[0].text.includes('B2')) throw new Error('Противоречие «немецкий» не разрешено');
if (!clarified.length) throw new Error('Уточнение не попало в журнал');
const chatFacts = model.sections.flatMap((s) => s.facts).filter((f) => f.source === 'Ответ в чате');
if (chatFacts.length !== 2) throw new Error('Источник «Ответ в чате» не проставлен');

// 4) Эвристическое слияние (без ИИ) — не должно падать
const model2 = mergeChatAnswer(model, 'Я готов ездить до 50 км и хочу хотя бы 900 евро');
const heur = model2.sections.flatMap((s) => s.facts).filter((f) => f.text.includes('50 км') || f.text.includes('900 евро'));
console.log('Эвристика: добавлено фактов =', model2.sections.reduce((n, s) => n + s.facts.length, 0) - after, '| найдено =', heur.length);
if (!heur.length) throw new Error('Эвристическое слияние не добавило факт');

// 5) Повторный ответ не дублирует факт
const snap = JSON.stringify(model.sections.map((s) => s.facts.map((f) => f.text)));
const model3 = mergeChatAnswer(model, 'Мой аттестат уже признан, я проверял в anabin', [
  { sectionId: 'documents', facts: ['Аттестат признан (проверено в anabin)'] },
]);
const snap3 = JSON.stringify(model3.sections.map((s) => s.facts.map((f) => f.text)));
console.log('Дедупликация повторных фактов:', snap === snap3 ? 'ok' : 'FAIL');
if (snap !== snap3) throw new Error('Дубликаты фактов из чата');

// 6) Текст для промпта
const text = personModelToText(model);
console.log('--- personModelToText (первые 12 строк) ---');
console.log(text.split('\n').slice(0, 12).join('\n'));
if (!text.includes('МОДЕЛЬ') === false && !text.includes('[Кто ты')) throw new Error('Текст модели пуст');
if (!text.includes('Ответ в чате')) throw new Error('Источники чата не попали в текст');

/* ================= Забывание по времени (полураспад доверия) ================= */

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

// 7) Полураспад: свежий факт почти не теряет уверенность, старый — сильно
const freshFact = model.sections.find((s) => s.id === 'languages')!.facts[0];
const effFresh = factEffective(freshFact, 'languages', NOW);
console.log('\nПолураспад: свежий факт (языки, ~сегодня) eff =', effFresh + '%');
if (effFresh < 85) throw new Error('Свежий факт не должен выцветать');

const oldFact: MemoryFact = { ...freshFact, at: daysAgo(400) };
const effOld = factEffective(oldFact, 'languages', NOW);
console.log('Тот же факт 400 дней спустя eff =', effOld + '%');
if (effOld >= freshFact.confidence * 0.6) throw new Error('Старый факт должен заметно выцветать');

// условия (полураспад 90 дн.) выцветают быстрее образования (540 дн.)
const condFact: MemoryFact = { text: 'Ожидания по доходу: 900 евро', source: 'Анкета', confidence: 95, at: daysAgo(200) };
const eduFact: MemoryFact = { text: 'Аттестат: Realschulabschluss', source: 'Анкета', confidence: 95, at: daysAgo(200) };
const effCond = factEffective(condFact, 'conditions', NOW);
const effEdu = factEffective(eduFact, 'education', NOW);
console.log('Доход 200 дней:', effCond + '%', '< образование 200 дней:', effEdu + '%');
if (effCond >= effEdu) throw new Error('Доход должен выцветать быстрее образования');

// 8) Уборка памяти: старые факты уходят в архив, модель остаётся честной
const dusty: PersonModel = JSON.parse(JSON.stringify(model));
// «состариваем» факт про аттестат (образование, полураспад 540 дн. → 800 дн. почти забыто)
const eduSec = dusty.sections.find((s) => s.id === 'education')!;
const target = eduSec.facts.find((f) => f.text.includes('аттестат/диплом')) ?? eduSec.facts[0];
target.at = daysAgo(1500);
// «подтачиваем» факт из документов — должен попасть в «устаревает»
// (полураспад документов 300 дн. × 0.7 за источник «Ответ в чате» = 210 дн.)
const condSec = dusty.sections.find((s) => s.id === 'documents')!;
if (condSec.facts.length) condSec.facts[0].at = daysAgo(250);

const { model: swept, report } = sweepMemory(dusty, NOW);
const archivedTexts = (swept.archivedFacts ?? []).map((f) => f.text);
console.log('\nУборка: в архив ушло =', report.forgottenNow.length, '| устаревает =', report.staleNow.length, '| архив всего =', report.archivedTotal);
console.log('  забыто:', report.forgottenNow.map((f) => `"${f.text.slice(0, 40)}…"`).join(', '));
if (!archivedTexts.includes(target.text)) throw new Error('Древний факт не уехал в архив');
if (swept.sections.find((s) => s.id === 'education')!.facts.some((f) => f.text === target.text))
  throw new Error('Забытый факт остался в секции');
const sweptText = personModelToText(swept);
if (sweptText.includes(target.text)) throw new Error('Забытый факт попал в промпт');
if (!sweptText.includes('Забыто по времени')) throw new Error('В промпте нет пометки об архиве');
if (!report.staleNow.length) throw new Error('Полустарый факт не попал в «устаревает»');
console.log('  промпт-текст: забытый факт исключён, пометка архива есть — ok');

// 9) Подтверждение сбрасывает распад, восстановление возвращает из архива
const confirmed = confirmFact(swept, target.text);
const backInSec = confirmed.sections.find((s) => s.id === 'education')!.facts.some((f) => f.text === target.text);
console.log('\nПодтверждение: факт вернулся в секцию =', backInSec, '| в архиве осталось =', (confirmed.archivedFacts ?? []).length);
if (!backInSec) throw new Error('Подтверждение не вернуло факт из архива');
const reEff = factEffective(confirmed.sections.find((s) => s.id === 'education')!.facts.find((f) => f.text === target.text)!, 'education', NOW);
if (reEff < 85) throw new Error('Подтверждённый факт должен быть свежим');
if (!confirmed.journal.some((j) => j.kind === 'reconfirmed')) throw new Error('Нет записи в журнале');

const manualForget = forgetFactNow(confirmed, 'Аттестат признан (проверено в anabin)');
if ((manualForget.archivedFacts ?? []).some((f) => f.text === 'Аттестат признан (проверено в anabin)') === false)
  throw new Error('Ручное забывание не сработало');
const restored = restoreFact(manualForget, 'Аттестат признан (проверено в anabin)');
if (!restored.sections.flatMap((s) => s.facts).some((f) => f.text === 'Аттестат признан (проверено в anabin)'))
  throw new Error('Восстановление из архива не сработало');
const purged = purgeFact(restored, 'Аттестат признан (проверено в anabin)');
if ((purged.archivedFacts ?? []).some((f) => f.text === 'Аттестат признан (проверено в anabin)'))
  throw new Error('Стирание не сработало');
console.log('Забыть руками → вернуть → стереть навсегда: ok');

// 10) Статусы для UI
const counts = factStatusCounts(swept, NOW);
console.log('\nСтатусы для панели: свежих =', counts.fresh, '| давних =', counts.aging, '| устаревает =', counts.stale, '| в архиве =', counts.archived);

console.log('\nВСЕ ПРОВЕРКИ ПАМЯТИ ПРОЙДЕНЫ');
