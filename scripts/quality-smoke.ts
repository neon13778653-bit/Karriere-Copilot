// Смоук-тест качества поиска: география, предфильтр, дубли, стабильная оценка, запросы, кеш, Arbeitsagentur.
// Запуск: bun scripts/quality-smoke.ts  (или npx tsx scripts/quality-smoke.ts)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-cache-'));
process.env.CACHE_DIR = TMP;

import { cached, cacheGet, cacheKey, cacheSet, pruneCache } from '../src/lib/cache';
import { distanceKm, findCity, isAnywhere, locationFit, parseRadiusKm } from '../src/lib/geo';
import { ageInDays, canonicalUrl, classifyHost, dedupeVacancies, diversify, preFilterHits, stableScore, trustOf } from '../src/lib/search-quality';
import { ausbildungStartYear, buildBroadQueries, buildQueries, mergeQueries, queryCity, searchTerm } from '../src/lib/search-queries';
import { baRadius, buildBaSearchUrl, fetchBaDetails, parseBaDetails, parseBaSearch, searchArbeitsagentur } from '../src/lib/sources/arbeitsagentur';

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---------- География ----------
  check('город: немецкое, транслит, английское и русское написание', findCity('Köln')?.name === 'Köln' && findCity('Koeln')?.name === 'Köln' && findCity('Cologne')?.name === 'Köln' && findCity('Кёльн')?.name === 'Köln' && findCity('München')?.name === 'München' && findCity('Мюнхен')?.name === 'München');
  check('город: адрес с индексом и пометки', findCity('60311 Frankfurt am Main')?.name === 'Frankfurt am Main' && findCity('Франкфурт-на-Майне')?.name === 'Frankfurt am Main' && findCity('Neu-Isenburg, Hessen')?.name === 'Neu-Isenburg');
  check('город: Frankfurt (Oder) не путается с Frankfurt am Main', findCity('Frankfurt (Oder)')?.name === 'Frankfurt (Oder)');
  check('город: неизвестное/пустое → null', findCity('Какая-то деревня') === null && findCity('') === null && findCity(null) === null);
  const nI = findCity('Neu-Isenburg')!, fr = findCity('Frankfurt')!, be = findCity('Berlin')!, mu = findCity('München')!;
  check('расстояние: Neu-Isenburg—Frankfurt ≈ 8 км', distanceKm(nI, fr) >= 6 && distanceKm(nI, fr) <= 12, String(distanceKm(nI, fr)));
  check('расстояние: Berlin—München ≈ 504 км', Math.abs(distanceKm(be, mu) - 504) <= 12, String(distanceKm(be, mu)));
  check('радиус из ответов анкеты', parseRadiusKm('В самом городе') === 15 && parseRadiusKm('+10 км от города') === 10 && parseRadiusKm('+25 км') === 25 && parseRadiusKm('+200 км') === 200 && parseRadiusKm('Вся федеральная земля / регион') === 150 && parseRadiusKm('Вся Германия') === Infinity && parseRadiusKm(undefined) === null);
  check('«вся Германия» распознаётся', isAnywhere('Вся Германия') && isAnywhere('deutschlandweit') && !isAnywhere('Берлин'));

  const me = { city: 'Neu-Isenburg', radius: '+25 км', relocation: undefined as string | undefined };
  const near = locationFit(me, { text: '60311 Frankfurt am Main' });
  check('место: Frankfurt в радиусе 25 км от Neu-Isenburg → рядом', near.status === 'near' && near.delta === 0 && /Недалеко/.test(near.note));
  const far = locationFit(me, { text: 'Hamburg' });
  check('место: Hamburg далеко → штраф и пояснение', far.status === 'far' && far.delta <= -20 && far.delta >= -32 && /Далеко/.test(far.note), `${far.distanceKm} км, delta ${far.delta}`);
  const farWilling = locationFit({ ...me, relocation: 'Готов переехать в другой город Германии' }, { text: 'Hamburg' });
  check('место: готов к переезду → штраф вдвое меньше', farWilling.delta > far.delta && farWilling.delta < 0);
  const farNotWilling = locationFit({ ...me, relocation: 'Не готов к переезду' }, { text: 'Hamburg' });
  check('место: «не готов к переезду» не смягчает штраф', farNotWilling.delta === far.delta);
  check('место: готовое расстояние (Arbeitsagentur) приоритетнее таблицы', locationFit(me, { text: 'Hamburg', distanceKm: 10 }).status === 'near');
  check('место: удалённая работа не штрафуется', locationFit(me, { text: 'Remote / Homeoffice möglich' }).status === 'remote');
  check('место: «вся Германия» или неизвестный город — без штрафа', locationFit({ city: 'Вся Германия' }, { text: 'Hamburg' }).delta === 0 && locationFit(me, { text: 'Kleindorf' }).status === 'unknown' && locationFit({ city: 'Неизвестный', radius: '+25 км' }, { text: 'Hamburg' }).status === 'unknown');

  // ---------- Адреса и фильтр ----------
  check('canonicalUrl: трекинг, www, фрагмент и слэш убираются', canonicalUrl('https://www.Example.de/job/123/?utm_source=x&gclid=1&id=7#top') === 'example.de/job/123?id=7');
  check('canonicalUrl: разные вакансии (id) не склеиваются', canonicalUrl('https://a.de/job?id=1') !== canonicalUrl('https://a.de/job?id=2'));
  check('источники: официальный / портал / сайт работодателя / прочее', classifyHost('https://www.arbeitsagentur.de/jobsuche/jobdetail/1') === 'official' && classifyHost('https://www.stepstone.de/stellenangebote--x') === 'portal' && classifyHost('https://karriere.acme.de/stelle/1') === 'direct' && classifyHost('https://blog.example.com/post') === 'other');
  check('доверие: official > direct > portal > other', trustOf('official') > trustOf('direct') && trustOf('direct') > trustOf('portal') && trustOf('portal') > trustOf('other'));

  const hits = [
    { url: 'https://www.youtube.com/watch?v=1', name: 'Ausbildung Fachinformatiker erklärt' },
    { url: 'https://de.indeed.com/q-fachinformatiker-jobs.html', name: '1.234 Fachinformatiker Stellenangebote in Köln' },
    { url: 'https://example.de/blog/gehalt', name: 'Fachinformatiker Gehalt 2026' },
    { url: 'https://karriere.acme.de/stelle/1?utm_source=google', name: 'Fachinformatiker (m/w/d) bei ACME' },
    { url: 'https://karriere.acme.de/stelle/1?utm_medium=cpc', name: 'Fachinformatiker (m/w/d) bei ACME' },
    { url: 'https://www.stepstone.de/stellenangebote--Elektriker-Koeln-ACME--123-inline.html', name: 'Elektriker (m/w/d) Köln' },
    { url: 'https://ausbildung.de/berufe/fachinformatiker/', name: 'Ausbildung Fachinformatiker/in: Gehalt, Dauer' },
    { url: 'kein-url', name: 'x' },
  ];
  const pf = preFilterHits(hits);
  const reasons = pf.dropped.map((d) => d.reason).sort();
  check('предфильтр: соцсеть, списки, статья, дубль адреса и битый URL отсеяны', pf.kept.length === 2 && reasons.join(',') === 'bad-url,blocked-domain,duplicate,info,info,listing', `kept=${pf.kept.length} dropped=${reasons.join(',')}`);
  check('предфильтр: вакансии с «(m/w/d)» остаются, у них есть доверие', pf.kept.every((k) => k.trust > 0) && pf.kept.some((k) => /ACME/.test(k.hit.name)));
  const realTitles = [
    'Ausbildung zum Fachinformatiker (m/w/d) 2027 bei ACME',
    'Elektriker (m/w/d) – 30 Tage Urlaub, Vollzeit',
    'Kfz-Mechatroniker/in – Ausbildungsbeginn 01.09.2027',
    '3 Schichten Lagerhelfer (m/w/d) gesucht',
    'Verkäufer (m/w/d) Teilzeit 20 Std.',
  ];
  check('предфильтр: настоящие вакансии с цифрами в заголовке не отсеиваются', realTitles.every((t, i) => preFilterHits([{ url: `https://karriere.x.de/stelle/${i}`, name: t }]).kept.length === 1));
  const pf2 = preFilterHits(hits, { minKeep: 4 });
  check('предфильтр: при нехватке возвращаем списки/статьи, но не соцсети', pf2.kept.length === 4 && !pf2.kept.some((k) => /youtube/.test(k.hit.url)));

  // ---------- Дубли ----------
  const dup = dedupeVacancies([
    { title: 'Fachinformatiker/in Systemintegration (m/w/d)', company: 'ACME GmbH', location: '50667 Köln', trust: 0.7, score: 80 },
    { title: 'Ausbildung zum Fachinformatiker Systemintegration', company: 'ACME', location: 'Köln', trust: 0.9, score: 70 },
    { title: 'Fachinformatiker Anwendungsentwicklung (m/w/d)', company: 'ACME GmbH', location: 'Köln', trust: 0.7, score: 70 },
    { title: 'Fachinformatiker/in Systemintegration', company: null, location: 'Köln', trust: 0.5, score: 50 },
    { title: 'Fachinformatiker/in Systemintegration', company: null, location: 'Köln', trust: 0.5, score: 50 },
  ]);
  check('дубли: один и тот же вакансия на двух порталах схлопнута, остаётся более надёжный источник', dup.removed === 1 && dup.kept.some((k) => k.trust === 0.9) && !dup.kept.some((k) => k.trust === 0.7 && /Systemintegration/.test(k.title)));
  check('дубли: другая специализация у той же компании не склеивается', dup.kept.some((k) => /Anwendungsentwicklung/.test(k.title)));
  check('дубли: без названия компании не склеиваем', dup.kept.filter((k) => !k.company).length === 2);
  const div = diversify(Array.from({ length: 6 }, (_, i) => ({ company: i < 5 ? 'Big AG' : 'Small GmbH', i })), 3);
  check('разнообразие: не больше 3 вакансий от одной компании', div.filter((d) => d.company === 'Big AG').length === 3 && div.length === 4);

  // ---------- Стабильная оценка ----------
  const s = (o: Parameters<typeof stableScore>[0]) => stableScore(o)!;
  check('оценка: одинаковые входные данные → одинаковый результат', s({ relevance: 3, requirementsFit: 3, trust: 0.7, locationDelta: 0 }) === s({ relevance: 3, requirementsFit: 3, trust: 0.7, locationDelta: 0 }));
  check('оценка: чем выше ступень соответствия, тем выше балл', s({ relevance: 4 }) > s({ relevance: 3 }) && s({ relevance: 3 }) > s({ relevance: 2 }) && s({ relevance: 1 }) > s({ relevance: 0 }));
  check('оценка: требования, расстояние, возраст и источник сдвигают балл в нужную сторону', s({ relevance: 3, requirementsFit: 4 }) > s({ relevance: 3, requirementsFit: 0 }) && s({ relevance: 3, locationDelta: -25 }) < s({ relevance: 3 }) && s({ relevance: 3, ageDays: 100 }) < s({ relevance: 3, ageDays: 3 }) && s({ relevance: 3, trust: 1 }) > s({ relevance: 3, trust: 0.5 }));
  check('оценка: «сырая» оценка ИИ почти не качает результат (±5 при разбросе 20 пунктов)', Math.abs(s({ relevance: 3, llmScore: 90 }) - s({ relevance: 3, llmScore: 70 })) <= 5);
  check('оценка: без ступени используется оценка ИИ с поправками; без ничего — null', s({ llmScore: 70, locationDelta: -10 }) === 60 && stableScore({}) === null);
  check('оценка: всегда в пределах 0–100', s({ relevance: 4, requirementsFit: 4, trust: 1, llmScore: 100 }) <= 100 && s({ relevance: 0, requirementsFit: 0, locationDelta: -32, ageDays: 200, llmScore: 0 }) >= 0);
  check('возраст публикации', ageInDays('2026-11-01', new Date('2026-11-11T12:00:00Z')) === 10 && ageInDays(undefined) === null && ageInDays('вчера') === null);

  // ---------- Запросы ----------
  const NOW = new Date('2026-11-07T12:00:00Z');
  check('год Ausbildung: с октября — следующий', ausbildungStartYear(new Date('2026-11-07')) === 2027 && ausbildungStartYear(new Date('2026-03-01')) === 2026 && ausbildungStartYear(new Date('2026-09-15')) === 2026);
  check('термин: немецкое название чистится от «(m/w/d)» и «/in»', searchTerm({ name: 'Fachinformatiker/in (m/w/d)' }) === 'Fachinformatiker' && searchTerm({ name: 'Ausbildung zum Kfz-Mechatroniker' }) === 'Kfz-Mechatroniker');
  check('термин: русское название заменяется немецким ключевым словом, без немецкого — null', searchTerm({ name: 'Работа с людьми', keywords: ['Pflegefachkraft Köln'] }) === 'Pflegefachkraft Köln' && searchTerm({ name: 'Работа с людьми' }) === null);
  check('город для запроса', queryCity('Кёльн') === 'Köln' && queryCity('Вся Германия') === '' && queryCity('Aalen') === 'Aalen' && queryCity('Неизвестная деревня') === '');

  const qA = buildQueries({ goal: 'ausbildung', terms: ['Fachinformatiker', 'Mediengestalter'], city: 'Кёльн', germanLevel: 'B1', now: NOW, limit: 8 });
  check('запросы Ausbildung: год 2027, порталы и город', qA[0] === 'Ausbildung Fachinformatiker Köln 2027' && qA.some((q) => /site:ausbildung\.de/.test(q)) && qA.some((q) => /site:arbeitsagentur\.de/.test(q)) && qA.every((q) => !/Кёльн/.test(q)));
  check('запросы: направления чередуются — второе не остаётся без запроса', qA[1].includes('Mediengestalter'));
  const qJ = buildQueries({ goal: 'job', terms: ['Elektriker'], city: 'Berlin', germanLevel: 'B2', now: NOW, limit: 6 });
  check('запросы работы: Stellenangebote, StepStone, Arbeitsagentur, Indeed, сайты работодателей', qJ[0] === 'Elektriker Stellenangebote Berlin' && qJ.some((q) => /site:stepstone\.de/.test(q)) && qJ.some((q) => /site:de\.indeed\.com/.test(q)) && qJ.some((q) => /Wir suchen/.test(q)));
  check('запросы: детерминированы — один вход, один результат', JSON.stringify(buildQueries({ goal: 'job', terms: ['Elektriker'], city: 'Berlin', now: NOW, limit: 6 })) === JSON.stringify(buildQueries({ goal: 'job', terms: ['Elektriker'], city: 'Berlin', now: NOW, limit: 6 })));
  check('запросы: слабый немецкий добавляет мягкий вход', buildQueries({ goal: 'job', terms: ['Elektriker'], city: 'Berlin', germanLevel: 'A2', now: NOW, limit: 20 }).some((q) => /English speaking/.test(q)) && buildQueries({ goal: 'ausbildung', terms: ['Elektriker'], city: 'Berlin', germanLevel: 'A2', now: NOW, limit: 20 }).some((q) => /Einstiegsqualifizierung/.test(q)));
  check('запросы: «вся Германия» — без города и без двойных пробелов', buildQueries({ goal: 'job', terms: ['Elektriker'], city: 'Вся Германия', now: NOW, limit: 3 }).every((q) => !/\s{2,}/.test(q) && !/Германия/.test(q)));
  check('запросы: лимит соблюдается, пустой список терминов даёт пустой результат', buildQueries({ goal: 'job', terms: ['A1x', 'B1x', 'C1x'], city: 'Berlin', now: NOW, limit: 4 }).length === 4 && buildQueries({ goal: 'job', terms: [], now: NOW, limit: 4 }).length === 0);
  check('запросы пошире: без города', buildBroadQueries('job', ['Elektriker'], NOW).every((q) => !/Berlin/.test(q)) && buildBroadQueries('ausbildung', ['Elektriker'], NOW)[0] === 'Ausbildung Elektriker 2027');
  const merged = mergeQueries(['a b c d', 'e f g h'], ['E F G H', 'i j k l', 'm n o p'], 4);
  check('слияние запросов: без повторов (регистр не важен), не больше лимита', merged.length === 4 && merged[2] === 'i j k l');

  // ---------- Кеш ----------
  const k = cacheKey('q', 'Elektriker Berlin');
  check('кеш: ключ стабилен и зависит от данных', k === cacheKey('q', 'Elektriker Berlin') && k !== cacheKey('q', 'Elektriker Köln') && /^[0-9a-f]{40}$/.test(k));
  check('кеш: пусто до записи', (await cacheGet('t', k, 60_000)) === undefined);
  await cacheSet('t', k, { a: [1, 2] });
  check('кеш: запись читается', JSON.stringify(await cacheGet('t', k, 60_000)) === '{"a":[1,2]}');
  await sleep(30);
  check('кеш: после срока годности запись не отдаётся', (await cacheGet('t', k, 10)) === undefined);
  let calls = 0;
  const f = async () => { calls++; return { n: calls }; };
  const r1 = await cached('c', 'x', 60_000, f);
  const r2 = await cached('c', 'x', 60_000, f);
  check('cached: второй вызов берётся из кеша, функция не вызывается', !r1.hit && r2.hit && calls === 1 && r2.value.n === 1);
  const r3 = await cached('c', 'y', 60_000, async () => [] as number[], (v) => v.length > 0);
  const r4 = await cached('c', 'y', 60_000, async () => [1], (v) => v.length > 0);
  check('cached: пустой/неудачный результат не закрепляется', !r3.hit && !r4.hit && r4.value.length === 1);
  fs.writeFileSync(path.join(TMP, 'c', 'bad.json'), '{oops');
  check('кеш: повреждённый файл молча игнорируется', (await cacheGet('c', 'bad', 60_000)) === undefined);
  for (let i = 0; i < 6; i++) await cacheSet('p', `k${i}`, i);
  const removed = await pruneCache(60_000, 3);
  check('prune: лишние файлы удаляются', removed >= 1 && (fs.readdirSync(path.join(TMP, 'p')).length) <= 3, `удалено ${removed}`);
  const odd = await cached('сеть/../x', 'a b/c', 1000, async () => 1);
  check('кеш: опасные символы в имени пространства и ключе не выводят из каталога кеша', odd.value === 1 && fs.readdirSync(TMP).every((d) => !d.includes('..')));

  // ---------- Arbeitsagentur ----------
  check('радиус BA: ближайший допустимый', baRadius(10) === 10 && baRadius(12) === 15 && baRadius(60) === 100 && baRadius(500) === 200 && baRadius(0) === undefined && baRadius(null) === undefined && baRadius(Infinity) === undefined);
  const urlA = buildBaSearchUrl({ was: 'Fachinformatiker', wo: 'Köln', umkreis: 25, goal: 'ausbildung' });
  const urlJ = buildBaSearchUrl({ was: 'Elektriker', goal: 'job' });
  check('URL BA: Ausbildung = angebotsart 4, работа = 1, радиус только при городе', /angebotsart=4/.test(urlA) && /umkreis=25/.test(urlA) && /wo=K%C3%B6ln/.test(urlA) && /angebotsart=1/.test(urlJ) && !/umkreis/.test(urlJ));
  const fixture = {
    stellenangebote: [
      { refnr: '10001-ABC-S', titel: 'Fachinformatiker/in', beruf: 'Fachinformatiker/in - Systemintegration', arbeitgeber: 'ACME GmbH', arbeitsort: { plz: '50667', ort: 'Köln', koordinaten: { lat: 50.94, lon: 6.96 }, entfernung: '3' }, aktuelleVeroeffentlichungsdatum: '2026-11-01', eintrittsdatum: '2027-09-01' },
      { refnr: '10002', beruf: 'Elektroniker/in', arbeitsort: { ort: 'Bonn' } },
      { titel: 'без refnr' },
      null,
      'мусор',
    ],
  };
  const parsed = parseBaSearch(fixture);
  check('BA: поиск разобран (название, работодатель, координаты, расстояние, даты, ссылка)', parsed.length === 2 && parsed[0].employer === 'ACME GmbH' && parsed[0].location === '50667 Köln' && parsed[0].lat === 50.94 && parsed[0].distanceKm === 3 && parsed[0].startDate === '2027-09-01' && parsed[0].postedAt === '2026-11-01' && parsed[0].url === 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-ABC-S');
  check('BA: запись без названия берёт профессию; мусор и пустое не ломают разбор', parsed[1].title === 'Elektroniker/in' && parseBaSearch(null).length === 0 && parseBaSearch({}).length === 0 && parseBaSearch({ stellenangebote: 'x' }).length === 0);
  const detailText = parseBaDetails({ titel: 'Fachinformatiker/in', stellenbeschreibung: '<p>Du <b>programmierst</b> &amp; testest.</p><ul><li>Deutsch B1</li></ul>', verguetungsangabe: '1000 EUR', arbeitszeitmodelle: ['VOLLZEIT'], unbekannt: 'игнор' });
  check('BA: детали превращаются в чистый текст для ИИ', /Описание: Du programmierst & testest/.test(detailText) && /Deutsch B1/.test(detailText) && /Оплата: 1000 EUR/.test(detailText) && /График: VOLLZEIT/.test(detailText) && !/игнор/.test(detailText) && !/<p>/.test(detailText));

  let seenUrl = '', seenKey = '';
  const okFetch = async (u: string, init?: { headers?: Record<string, string> }) => { seenUrl = u; seenKey = init?.headers?.['X-API-Key'] ?? ''; return { ok: true, status: 200, json: async () => fixture }; };
  const res = await searchArbeitsagentur({ was: 'Fachinformatiker', wo: 'Köln', goal: 'ausbildung' }, okFetch);
  check('BA: запрос идёт с ключом API и нужным адресом', res.jobs.length === 2 && !res.error && seenKey === 'jobboerse-jobsuche' && /\/pc\/v4\/jobs\?/.test(seenUrl));
  const failFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const resFail = await searchArbeitsagentur({ was: 'x', goal: 'job' }, failFetch);
  check('BA: ошибка сервера → пустой результат и пояснение (поиск продолжится через веб)', resFail.jobs.length === 0 && /503/.test(resFail.error ?? ''));
  const resThrow = await searchArbeitsagentur({ was: 'x', goal: 'job' }, async () => { throw new Error('offline'); });
  check('BA: сеть недоступна → пустой результат, без исключения', resThrow.jobs.length === 0 && resThrow.error === 'offline');
  let detailUrl = '';
  const det = await fetchBaDetails('10001-ABC-S', async (u) => { detailUrl = u; return { ok: true, status: 200, json: async () => ({ stellenbeschreibung: 'Text ' + 'x'.repeat(50) }) }; });
  check('BA: адрес деталей — base64 от refnr, текст получен', detailUrl.endsWith('/jobdetails/' + Buffer.from('10001-ABC-S').toString('base64')) && !!det && det.startsWith('Описание: Text'));
  check('BA: деталей нет → null', (await fetchBaDetails('x', failFetch)) === null);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ КАЧЕСТВА ПОИСКА ПРОЙДЕНЫ');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
