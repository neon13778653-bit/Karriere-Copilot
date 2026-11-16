// Сквозной тест поиска: настоящий runSearchPipeline на заглушках (БД, DNS, SearXNG, Arbeitsagentur, сайты вакансий, ИИ).
// Проверяет то, что нельзя проверить по частям: нумерацию блоков, отсев мусора, дубли, проверку ссылок, расстояние,
// стабильность оценок и кеш. Запуск: npx tsx scripts/pipeline-smoke.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: any;

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-pipe-'));
const DIR_A = path.join(TMP, 'a');
const DIR_C = path.join(TMP, 'c');
process.env.CACHE_DIR = DIR_A;
process.env.SEARXNG_URL = 'http://searx.test';
process.env.BRAVE_API_KEY = '';
process.env.LLM_BASE_URL = '';

/* ------------------------------ заглушка БД ------------------------------ */
const rows: any[] = [];
const dbPath = require.resolve('../src/lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, children: [], paths: [],
  exports: {
    db: {
      vacancy: {
        createMany: async ({ data }: any) => { for (const d of data) rows.push({ id: 'v' + rows.length, createdAt: new Date(), ...d }); return { count: data.length }; },
        findMany: async ({ where }: any) => rows.filter((r) => r.sessionId === where.sessionId).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      },
    },
  },
};

/* ------------------------------ заглушка DNS ------------------------------ */
const dnsMod = require('node:dns/promises');
const realLookup = dnsMod.lookup;
dnsMod.lookup = async (host: string, opts: any) =>
  host.endsWith('.test') || host === 'www.stepstone.de' || host.endsWith('arbeitsagentur.de')
    ? [{ address: '93.184.216.34', family: 4 }]
    : realLookup(host, opts);

/* ------------------------------ мир вакансий ------------------------------ */
interface PoolItem { url: string; title: string; content: string }
const pool: PoolItem[] = [];
for (let n = 1; n <= 14; n++) pool.push({ url: `https://karriere.firma${n}.test/stelle/${n}`, title: `Ausbildung Fachinformatiker (m/w/d) bei Firma${n}`, content: `Ort: ${n % 7 === 0 ? 'Offenbach' : 'Frankfurt'}. Wir bilden aus.` });
for (let k = 1; k <= 5; k++) pool.push({ url: `https://karriere.flood.test/stelle/${k}`, title: `Ausbildung Fachinformatiker Variante${k} (m/w/d) bei Flood AG`, content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.hamburg.test/stelle/h1', title: 'Ausbildung Fachinformatiker (m/w/d) bei Nordlicht Hamburg', content: 'Ort: Hamburg.' });
pool.push({ url: 'https://www.stepstone.de/stellenangebote--Fachinformatiker-Dupe--1.html', title: 'Ausbildung Fachinformatiker Systemintegration (m/w/d) bei Dupe', content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.dupe.test/stelle/1', title: 'Fachinformatiker/in Systemintegration bei Dupe', content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.tot.test/stelle/404', title: 'Ausbildung Fachinformatiker (m/w/d) bei Tot', content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.abgelaufen.test/stelle/9', title: 'Ausbildung Fachinformatiker (m/w/d) bei Abgelaufen', content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.bot.test/stelle/5', title: 'Ausbildung Fachinformatiker (m/w/d) bei Bot', content: 'Ort: Frankfurt.' });
pool.push({ url: 'https://karriere.gut.test/stelle/1', title: 'Ausbildung Fachinformatiker (m/w/d) bei Gut', content: 'Ort: Frankfurt.' });
// мусор, который должен отсеяться ДО ИИ
const JUNK = ['https://www.youtube.com/watch?v=1', 'https://de.indeed.com/q-fachinformatiker.html', 'https://example.test/blog/gehalt'];
pool.push({ url: JUNK[0], title: 'Fachinformatiker Ausbildung erklärt', content: 'Video' });
pool.push({ url: JUNK[1], title: '1.234 Fachinformatiker Stellenangebote in Köln', content: 'Liste' });
pool.push({ url: JUNK[2], title: 'Fachinformatiker Gehalt 2026', content: 'Ratgeber' });

const BA_JOBS = [
  { refnr: '10001-FRA-S', titel: 'Fachinformatiker/in Anwendungsentwicklung', arbeitgeber: 'BA-Frankfurt GmbH', arbeitsort: { plz: '60311', ort: 'Frankfurt am Main', koordinaten: { lat: 50.11, lon: 8.68 }, entfernung: '9' }, aktuelleVeroeffentlichungsdatum: '2026-11-02', eintrittsdatum: '2027-09-01' },
  { refnr: '10002-KOE-S', titel: 'Fachinformatiker/in Systemintegration', arbeitgeber: 'BA-Köln AG', arbeitsort: { plz: '50667', ort: 'Köln', koordinaten: { lat: 50.94, lon: 6.96 }, entfernung: '160' }, aktuelleVeroeffentlichungsdatum: '2026-11-03' },
  { refnr: '10003-OFF-S', titel: 'Mediengestalter/in Digital', arbeitgeber: 'BA-Offenbach KG', arbeitsort: { plz: '63065', ort: 'Offenbach am Main', koordinaten: { lat: 50.1, lon: 8.77 }, entfernung: '5' }, aktuelleVeroeffentlichungsdatum: '2026-11-04' },
];
const BA_DETAIL = 'Die Ausbildung dauert 3 Jahre. Voraussetzung: Realschulabschluss und Deutsch B1. Bewerbung bis 20.12.2026 an bewerbung@acme.de. ' + 'Wir bieten spannende Aufgaben in der IT. '.repeat(12);

const longText = 'Wir suchen Auszubildende zum Fachinformatiker. Voraussetzung: Realschulabschluss, Deutsch B1. Bewerbung per E-Mail. '.repeat(6);
const ld = (valid: string, org: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Fachinformatiker', validThrough: valid, datePosted: '2026-10-20', hiringOrganization: { name: org }, jobLocation: { address: { addressLocality: 'Frankfurt' } }, employmentType: 'FULL_TIME' })}</script>`;

/* ------------------------------ счётчики и поведение ИИ ------------------------------ */
const llmPrompts: string[] = [];
const calls = { strategy: 0, extract: 0, page: 0 };
let jitter = 0; // сдвиг «сырой» оценки ИИ: проверяем, что итоговая оценка почти не зависит от него

function fakeLlm(prompt: string): string {
  llmPrompts.push(prompt);
  if (prompt.includes('планировщик поисковых запросов')) {
    calls.strategy++;
    return JSON.stringify({ queries: ['Fachinformatiker Ausbildung Offenbach Umgebung'] });
  }
  if (prompt.includes('аналитик вакансий в Германии')) {
    calls.extract++;
    const out: any[] = [];
    const re = /^(\d+)\. (.*)\n\s+URL: (\S+)\n\s+Источник: (.*)\n\s+Сниппет: (.*)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt))) {
      const [, num, name, url, , snippet] = m;
      const company = / bei (.+)$/.exec(name)?.[1] ?? / — (.+)$/.exec(name)?.[1] ?? null;
      const loc = /(?:Ort|Место): ([^.]+)/.exec(snippet)?.[1] ?? null;
      const special = /tot|abgelaufen|bot|gut|dupe|flood|hamburg/.test(new URL(url).hostname);
      const n = Number(num);
      out.push({ i: n, title: name, company, location: loc, relevance: special ? 4 : n % 2 === 0 ? 3 : 2, score: 70 + jitter + (n % 3) * 5, verdict: 'ok', reasons: ['совпадает с профилем'], risks: [], tags: ['IT'] });
    }
    return JSON.stringify({ vacancies: out });
  }
  if (prompt.includes('карьерный аналитик')) {
    calls.page++;
    const out: any[] = [];
    const re = /^(\d+)\. «(.*?)» \(.*?\), текущая оценка/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt))) {
      out.push({
        i: Number(m[1]), score: 75 + jitter, requirementsFit: 3, verdict: 'подходит',
        description: 'Ausbildung в IT.',
        details: { deadline: null, germanRequired: 'B1', education: 'Realschulabschluss', duration: '3 года', requirements: ['Interesse an IT'], tasks: ['Support'], benefits: [], howToApply: 'E-Mail', contact: 'bewerbung@acme.de' },
        fit: { advice: 'apply', summary: 'Подходит.', matches: ['IT-направление'], gaps: [], blockers: [], actions: ['Подготовь Zeugnis'] },
      });
    }
    return JSON.stringify({ items: out });
  }
  return '{}';
}

const realFetch = globalThis.fetch;
function install() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input);
    const u = new URL(url);
    const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.host === 'searx.test') {
      // как настоящая поисковая система: разные запросы дают разные окна выдачи, один и тот же запрос — всегда одно и то же
      const q = u.searchParams.get('q') ?? '';
      let h = 0;
      for (const ch of q) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const start = (h % 3) * 10;
      return json({ results: pool.slice(start, start + 10).map((p) => ({ url: p.url, title: p.title, content: p.content })) });
    }
    if (u.host === 'llm.test') return json({ choices: [{ message: { content: fakeLlm(JSON.parse(init.body).messages[1].content) } }] });
    if (u.host === 'rest.arbeitsagentur.de') {
      if (u.pathname.endsWith('/jobs')) return json({ stellenangebote: BA_JOBS });
      return json({ stellenbeschreibung: BA_DETAIL, titel: 'Fachinformatiker/in' });
    }
    if (u.host === 'karriere.tot.test') return html('weg', 404);
    if (u.host === 'karriere.bot.test') return html('bot', 403);
    if (u.host === 'www.stepstone.de') return html('bot', 403);
    if (u.host === 'karriere.abgelaufen.test') return html(`<html><head>${ld('2020-01-01', 'Abgelaufen')}</head><body>${longText}</body></html>`);
    if (u.host === 'karriere.gut.test') return html(`<html><head>${ld('2027-06-30', 'Gut GmbH')}</head><body>${longText}</body></html>`);
    if (u.host.endsWith('.test')) return html(`<html><body>${longText}</body></html>`);
    return html('not found', 404);
  }) as typeof fetch;
}

/* ------------------------------ запуск ------------------------------ */
async function run(mode: 'max') {
  const { runSearchPipeline } = await import('../src/lib/search');
  const profile: any = { goal: 'ausbildung', decided: true, position: 'Fachinformatiker', city: 'Neu-Isenburg', radius: '+25 км', germanLevel: 'B1', graduation: 'Realschulabschluss / Mittlere Reife', relocation: 'Только из дома или рядом' };
  rows.length = 0;
  const events: any[] = [];
  for await (const ev of runSearchPipeline({
    profile, goal: 'ausbildung', mode, sessionId: 's1',
    backend: { provider: 'custom', customUrl: 'http://llm.test/v1', customModel: 'x' } as any,
    savedAnalysis: { portrait: 'Тест', directions: ['Fachinformatiker/in', 'Mediengestalter/in'] },
  })) events.push(ev);
  const vac = events.find((e) => e.type === 'vacancies');
  return { events, items: (vac?.items ?? []) as any[], logs: events.filter((e) => e.type === 'log').map((e) => e.text as string) };
}

async function main() {
  install();

  // ---------- Прогон A: чистый кеш, оценка ИИ без сдвига ----------
  jitter = 0;
  const A = await run('max');
  check('A: поиск завершился списком вакансий, без ошибки', A.items.length > 0 && !A.events.some((e) => e.type === 'error'), `вакансий: ${A.items.length}`);
  if (process.env.DEBUG_PIPE) {
    console.log('LOGS:\n' + A.logs.join('\n'));
    console.log('ITEMS:\n' + A.items.map((v) => `${v.score} | ${v.title} | ${v.company} | ${v.url} | ${v.intel?.link?.state}`).join('\n'));
  }
  const allPrompts = llmPrompts.join('\n');
  check('A: мусор отсеян ДО ИИ (соцсеть, список «1.234 …», статья)', JUNK.every((j) => !allPrompts.includes(j)) && A.logs.some((l) => /Отсеял до анализа/.test(l)));
  const byUrl = new Map(A.items.map((v) => [v.url, v]));
  check('A: нумерация блоков верна: ни одна вакансия из 2-го блока не потеряна и не прилипла к чужой ссылке', A.items.filter((v) => /karriere\.(firma|flood|gut|dupe|bot|hamburg)/.test(v.url)).every((v) => { const host = new URL(v.url).hostname.split('.')[1]; return v.title.toLowerCase().includes(host.replace('firma', 'firma')) || v.title.toLowerCase().includes(({ flood: 'flood', gut: 'gut', dupe: 'dupe', bot: 'bot', hamburg: 'hamburg' } as any)[host] ?? host); }) && calls.extract >= 2 && A.items.length === 24);
  check('A: 404 и «срок истёк» исключены, о них сказано в логе', !byUrl.has('https://karriere.tot.test/stelle/404') && !byUrl.has('https://karriere.abgelaufen.test/stelle/9') && A.logs.some((l) => /неактуальных исключил — 2/.test(l)));
  const bot = byUrl.get('https://karriere.bot.test/stelle/5');
  check('A: сайт, не пустивший бота, остаётся с пометкой «проверь сам» и осторожной рекомендацией', !!bot && bot.intel?.link.state === 'unverified' && bot.intel?.fit?.basedOnPage === false && bot.intel?.fit?.advice !== 'apply');
  const dupes = A.items.filter((v) => /dupe|Dupe/.test(v.url));
  check('A: одна вакансия на двух порталах — одна запись, остался сайт работодателя', dupes.length === 1 && /karriere\.dupe\.test/.test(dupes[0].url));
  check('A: не больше 3 вакансий от одной компании', A.items.filter((v) => /karriere\.flood/.test(v.url)).length === 3);

  const gut = byUrl.get('https://karriere.gut.test/stelle/1');
  check('A: ссылка проверена, срок и дата публикации взяты из разметки страницы', !!gut && gut.intel?.link.state === 'ok' && gut.intel?.details?.deadline === '2027-06-30' && gut.intel?.details?.postedAt === '2026-10-20');
  check('A: выдуманный ИИ контакт на обычной странице отброшен', !!gut && gut.intel?.details?.contact === null);

  const ba1 = A.items.find((v) => /10001-FRA-S/.test(v.url));
  const ba2 = A.items.find((v) => /10002-KOE-S/.test(v.url));
  check('A: вакансии Arbeitsagentur присутствуют, ссылка помечена как официальная', !!ba1 && !!ba2 && /Arbeitsagentur/.test(ba1.intel?.link.note ?? '') && ba1.intel?.link.state === 'ok');
  check('A: из деталей Arbeitsagentur получены контакт (он есть в тексте) и требования', ba1?.intel?.details?.contact === 'bewerbung@acme.de' && (ba1?.intel?.details?.requirements.length ?? 0) > 0);
  check('A: данные биржи перекрывают разбор ИИ (работодатель, место, старт)', ba1?.company === 'BA-Frankfurt GmbH' && ba1?.location === '60311 Frankfurt am Main' && ba1?.intel?.details?.startDate === '2027-09-01');
  check('A: вакансия за 160 км при радиусе 25 км получает пометку «Далеко» и оценку ниже, чем рядом', !!ba1 && !!ba2 && (ba2.intel?.fit?.gaps ?? []).some((g: string) => /Далеко/.test(g)) && ba2.score < ba1.score, `рядом ${ba1?.score}, далеко ${ba2?.score}`);
  const hamb = byUrl.get('https://karriere.hamburg.test/stelle/h1');
  check('A: Hamburg для жителя Neu-Isenburg — далеко (город определён по тексту)', !!hamb && (hamb.intel?.fit?.gaps ?? []).some((g: string) => /Далеко/.test(g)));
  check('A: у близких вакансий отмечено «Недалеко»', !!ba1 && (ba1.intel?.fit?.matches ?? []).some((m: string) => /Недалеко/.test(m)));
  check('A: в базу сохранены данные проверки и рекомендации', rows.length === A.items.length && rows.every((r) => { try { const i = JSON.parse(r.intel); return i && i.link && i.fit; } catch { return false; } }) && rows.every((r) => r.searchMode === 'max'));
  check('A: оценки в диапазоне 0–100, список отсортирован по убыванию', A.items.every((v) => v.score >= 0 && v.score <= 100) && A.items.every((v, i, a) => i === 0 || a[i - 1].score >= v.score));
  const scoresA = new Map(A.items.map((v) => [v.url, v.score as number]));
  const extractCallsA = calls.extract;

  // ---------- Прогон B: тот же кеш, ИИ «изменился» — результат обязан совпасть из кеша ----------
  jitter = 15;
  const before = { ...calls };
  const B = await run('max');
  check('B: повторный поиск взят из кеша — к ИИ за разбором не обращались', calls.extract === before.extract && calls.page === before.page && B.logs.some((l) => /Из кеша взято запросов/.test(l)) && B.logs.some((l) => /из кеша/.test(l)));
  check('B: оценки идентичны прогону A', B.items.length === A.items.length && B.items.every((v) => scoresA.get(v.url) === v.score));

  // ---------- Прогон C: кеш отключён, «сырая» оценка ИИ сдвинута на +15 ----------
  process.env.CACHE_DIR = DIR_C;
  process.env.SEARCH_CACHE_HOURS = '0';
  const C = await run('max');
  check('C: без кеша ИИ вызывался заново', calls.extract > extractCallsA);
  const common = C.items.filter((v) => scoresA.has(v.url));
  const maxDiff = Math.max(...common.map((v) => Math.abs(v.score - (scoresA.get(v.url) as number))));
  check('C: сдвиг «сырой» оценки ИИ на 15 пунктов меняет итоговую оценку не более чем на 4', common.length >= 10 && maxDiff <= 4, `сравнено ${common.length}, макс. разница ${maxDiff}`);
  check('C: тот же набор вакансий и тот же порядок первых пяти', C.items.length === A.items.length && C.items.slice(0, 5).map((v) => v.url).join() === A.items.slice(0, 5).map((v) => v.url).join());

  globalThis.fetch = realFetch;
  dnsMod.lookup = realLookup;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ СКВОЗНОГО ПОИСКА ПРОЙДЕНЫ');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
