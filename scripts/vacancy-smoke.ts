// Смоук-тест проверки вакансий: ссылка, подробности, рекомендация «подходит ли мне».
// Запуск: bun scripts/vacancy-smoke.ts  (или npx tsx scripts/vacancy-smoke.ts)

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assessLink,
  computeFit,
  detectClosedSignal,
  educationRank,
  focusText,
  germanRank,
  groundContact,
  intelToText,
  normalizeDetails,
  parseDateLoose,
  parseIntel,
  parseJobPostingLd,
  requiredGermanRank,
  type PageInspection,
} from '../src/lib/vacancy-intel';
import { inspectPage } from '../src/lib/web';
import type { LinkCheck, UserProfile, VacancyDetails } from '../src/lib/types';

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

const NOW = new Date('2026-11-10T12:00:00Z');
const okLink: LinkCheck = { state: 'ok', note: 'ok', pageRead: true, checkedAt: NOW.toISOString() };
const emptyDetails = (over: Partial<VacancyDetails> = {}): VacancyDetails => ({
  source: 'page', requirements: [], tasks: [], benefits: [], ...over,
});
const LONG = 'Wir suchen dich als Fachinformatiker. '.repeat(20);

async function main() {
  // ---------- Уровни и образование ----------
  check('профиль: уровень немецкого', germanRank('B1') === 3 && germanRank('Не знаю немецкого') === 0 && germanRank('') === null && germanRank('B1–B2') === 4);
  check('вакансия: «B1/B2» → минимально достаточный B1', requiredGermanRank('Deutsch B1/B2') === 3);
  check('вакансия: слова вместо уровня', requiredGermanRank('verhandlungssicheres Deutsch') === 5 && requiredGermanRank('gute Deutschkenntnisse') === 4 && requiredGermanRank('Grundkenntnisse') === 2 && requiredGermanRank('Deutsch') === null);
  check('образование: Fachabitur не путается с Abitur и вузом', educationRank('Fachhochschulreife') === 3 && educationRank('Abitur') === 4 && educationRank('Allgemeine Hochschulreife') === 4 && educationRank('Realschulabschluss') === 2 && educationRank('Hauptschulabschluss') === 1 && educationRank('Bachelor') === 5);
  check('даты: ISO и немецкий формат', parseDateLoose('2026-12-31')?.getUTCDate() === 31 && parseDateLoose('15.01.27')?.getUTCFullYear() === 2027 && parseDateLoose('ab sofort') === null);

  // ---------- JSON-LD ----------
  const ldHtml = (valid: string) => `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebSite' }, {
      '@type': 'JobPosting', title: 'Fachinformatiker/in', datePosted: '2026-10-01', validThrough: valid,
      employmentType: ['FULL_TIME'], hiringOrganization: { '@type': 'Organization', name: 'ACME GmbH' },
      jobLocation: { address: { addressLocality: 'Köln', postalCode: '50667' } },
      baseSalary: { currency: 'EUR', value: { minValue: 1000, maxValue: 1200, unitText: 'MONTH' } },
    }],
  })}</script></head><body>${'Text '.repeat(100)}</body></html>`;
  const ld = parseJobPostingLd(ldHtml('2026-12-31'))!;
  check('JSON-LD: компания, город, срок, зарплата, тип занятости', ld.company === 'ACME GmbH' && ld.location === '50667 Köln' && ld.deadline === '2026-12-31' && ld.salary === '1000–1200 EUR в месяц' && ld.employmentType === 'Vollzeit');
  check('JSON-LD: битая/чужая разметка не ломает разбор', parseJobPostingLd('<script type="application/ld+json">{oops</script>') === null && parseJobPostingLd('') === null);

  // ---------- Признаки закрытой вакансии ----------
  check('закрыта: «Diese Stelle wurde bereits besetzt»', detectClosedSignal('Leider: Diese Stelle wurde bereits besetzt. Weitere Jobs') !== null);
  check('закрыта: английская и русская формулировки', detectClosedSignal('This job is no longer available') !== null && detectClosedSignal('Вакансия закрыта') !== null);
  check('обычная вакансия не считается закрытой', detectClosedSignal('Wir suchen Verstärkung. Bewerbung bis 31.12. Die Stelle ist ab sofort zu besetzen.') === null);
  check('фраза в самом низу страницы (футер) игнорируется', detectClosedSignal('Willkommen. '.repeat(500) + 'Diese Stelle wurde besetzt') === null);

  // ---------- Проверка ссылки ----------
  const url = 'https://jobs.example.com/stelle/123';
  const A = (ins: PageInspection) => assessLink(url, ins, NOW).link;
  check('404 → неактуальна', A({ reachable: false, httpStatus: 404 }).state === 'closed');
  check('410 → неактуальна', A({ reachable: false, httpStatus: 410 }).state === 'closed');
  check('403 (сайт не пускает бота) → «проверь сам», а НЕ закрыта', A({ reachable: false, httpStatus: 403 }).state === 'unverified');
  check('500 / таймаут / сеть → «проверь сам»', A({ reachable: false, httpStatus: 503 }).state === 'unverified' && A({ reachable: false, error: 'timeout' }).state === 'unverified' && A({ reachable: false, error: 'network' }).state === 'unverified');
  check('нормальная страница → ок, текст прочитан', (() => { const l = A({ reachable: true, httpStatus: 200, text: LONG, html: '<html></html>' }); return l.state === 'ok' && l.pageRead; })());
  check('разметка со сроком в прошлом → неактуальна', A({ reachable: true, httpStatus: 200, text: LONG, html: ldHtml('2026-10-15') }).state === 'closed');
  check('разметка со сроком в будущем → ок и срок в пояснении', (() => { const l = A({ reachable: true, httpStatus: 200, text: LONG, html: ldHtml('2026-12-31') }); return l.state === 'ok' && /2026-12-31/.test(l.note); })());
  check('на странице «Stelle besetzt» → неактуальна', A({ reachable: true, httpStatus: 200, text: 'Diese Stelle wurde besetzt. ' + LONG, html: '' }).state === 'closed');
  check('редирект на главную → «проверь сам»', assessLink(url, { reachable: true, httpStatus: 200, finalUrl: 'https://jobs.example.com/', text: LONG, html: '' }, NOW).link.state === 'unverified');
  check('почти пустая страница → «проверь сам»', A({ reachable: true, httpStatus: 200, text: 'Loading…', html: '' }).state === 'unverified');

  // ---------- Текст для ИИ и контакты ----------
  const tail = 'Einleitung. '.repeat(300) + 'Bewerbungsfrist ist der 31.12.2026. Kontakt: Frau Meier, jobs@acme.de, Tel. +49 221 123456.';
  check('focusText: срок и контакт из хвоста страницы не теряются', (() => { const f = focusText(tail, 1500); return f.length <= 1600 && /31\.12\.2026/.test(f) && /jobs@acme\.de/.test(f); })());
  const page = 'Kontakt: Frau Meier, jobs@acme.de, Tel. +49 221 123456';
  check('контакт: настоящий e-mail и телефон принимаются', groundContact('jobs@acme.de, +49 221 123456', page) !== null);
  check('контакт: выдуманный e-mail отбрасывается', groundContact('hr@gmail.com', page) === null);
  check('контакт: выдуманный телефон отбрасывается', groundContact('+49 30 9999999', page) === null);
  check('контакт: имя принимается, только если есть на странице', groundContact('Frau Meier', page) !== null && groundContact('Herr Schmidt', page) === null);

  const nd = normalizeDetails({
    deadline: '01.01.2020', salary: '99999', germanRequired: 'B1', requirements: Array.from({ length: 12 }, (_, i) => 'Req ' + i), contact: 'hr@fake.com', howToApply: 'Online 😀',
  }, { source: 'page', ld, pageText: page });
  check('подробности: данные разметки сильнее ответа ИИ', nd.deadline === '2026-12-31' && nd.salary === '1000–1200 EUR в месяц');
  check('подробности: списки обрезаны, выдуманный контакт убран, эмодзи убраны', nd.requirements.length === 6 && nd.contact === null && nd.howToApply === 'Online');
  check('подробности: мусор вместо объекта не ломает разбор', normalizeDetails('мусор', { source: 'snippet' }).requirements.length === 0);

  // ---------- Рекомендация ----------
  const jobProfile: UserProfile = { goal: 'job', germanLevel: 'A2' };
  const gap3 = computeFit({ profile: jobProfile, goal: 'job', link: okLink, details: emptyDetails({ germanRequired: 'C1' }), score: 85, pageAnalyzed: true, now: NOW });
  check('немецкий: разрыв ≥2 уровней = жёсткий блок, «пропустить», оценка ограничена 35', gap3.fit.advice === 'skip' && gap3.fit.blockers.length === 1 && gap3.scoreCap === 35);
  const gap1 = computeFit({ profile: { goal: 'job', germanLevel: 'B1' }, goal: 'job', link: okLink, details: emptyDetails({ germanRequired: 'B2' }), score: 85, pageAnalyzed: true, now: NOW });
  check('немецкий: разрыв в 1 уровень — пробел, а не блок', gap1.fit.blockers.length === 0 && gap1.fit.gaps.some((g) => /B2/.test(g)) && gap1.fit.advice !== 'skip');
  const same = computeFit({ profile: { goal: 'job', germanLevel: 'B2' }, goal: 'job', link: okLink, details: emptyDetails({ germanRequired: 'B1' }), score: 85, pageAnalyzed: true, now: NOW });
  check('всё подходит и страница прочитана → «Откликайся»', same.fit.advice === 'apply' && same.fit.label === 'Откликайся' && same.fit.matches.length > 0 && same.scoreCap === null);
  const snippetOnly = computeFit({ profile: { goal: 'job', germanLevel: 'B2' }, goal: 'job', link: { ...okLink, pageRead: false }, details: emptyDetails({ source: 'snippet' }), score: 95, pageAnalyzed: false, now: NOW });
  check('без текста страницы уверенное «откликайся» не даём', snippetOnly.fit.advice === 'maybe' && !snippetOnly.fit.basedOnPage && /открой вакансию/.test(snippetOnly.fit.summary));
  const llmOptimist = computeFit({ profile: jobProfile, goal: 'job', link: okLink, details: emptyDetails(), llm: { advice: 'apply', summary: 'Супер!' }, score: 40, pageAnalyzed: true, now: NOW });
  check('ИИ не может поднять рекомендацию выше оценки', llmOptimist.fit.advice === 'skip');
  const llmPessimist = computeFit({ profile: jobProfile, goal: 'job', link: okLink, details: emptyDetails(), llm: { advice: 'skip' }, score: 90, pageAnalyzed: true, now: NOW });
  check('ИИ может понизить рекомендацию', llmPessimist.fit.advice === 'skip');
  const dead = computeFit({ profile: jobProfile, goal: 'job', link: { ...okLink, state: 'closed', note: 'Срок подачи истёк (2026-10-15).' }, details: emptyDetails(), score: 90, pageAnalyzed: true, now: NOW });
  check('закрытая вакансия → «пропустить» с причиной', dead.fit.advice === 'skip' && /Срок подачи истёк/.test(dead.fit.blockers[0]));
  const pastDeadline = computeFit({ profile: jobProfile, goal: 'job', link: okLink, details: emptyDetails({ deadline: '2026-11-01' }), score: 90, pageAnalyzed: true, now: NOW });
  check('срок прошёл, а ссылка «жива» → блок', pastDeadline.fit.advice === 'skip' && pastDeadline.fit.blockers.some((b) => /прошёл/.test(b)));
  const soon = computeFit({ profile: { goal: 'job', germanLevel: 'B2' }, goal: 'job', link: okLink, details: emptyDetails({ deadline: '2026-11-15' }), score: 85, pageAnalyzed: true, now: NOW });
  check('срок через 5 дней → напоминание в «что сделать»', soon.fit.actions.some((a) => /скоро/.test(a)));
  const manyGaps = computeFit({ profile: { goal: 'job', germanLevel: 'B2' }, goal: 'job', link: okLink, details: emptyDetails(), llm: { gaps: ['a', 'b', 'c'] }, score: 90, pageAnalyzed: true, now: NOW });
  check('3 пробела и больше → «apply» понижается до «maybe»', manyGaps.fit.advice === 'maybe' && manyGaps.scoreCap === 79);

  const ausProfile: UserProfile = { goal: 'ausbildung', graduation: 'Hauptschulabschluss', germanLevel: 'B1' };
  const ausBlock = computeFit({ profile: ausProfile, goal: 'ausbildung', link: okLink, details: emptyDetails({ education: 'Abitur' }), score: 85, pageAnalyzed: true, now: NOW });
  check('Ausbildung: нужен Abitur, есть Hauptschule → жёсткий блок', ausBlock.fit.advice === 'skip' && ausBlock.fit.blockers.length === 1);
  const ausGap = computeFit({ profile: { goal: 'ausbildung', graduation: 'Realschulabschluss / Mittlere Reife' }, goal: 'ausbildung', link: okLink, details: emptyDetails({ education: 'Fachabitur' }), score: 85, pageAnalyzed: true, now: NOW });
  check('Ausbildung: нужен Fachabitur, есть Realschule → пробел', ausGap.fit.blockers.length === 0 && ausGap.fit.gaps.length === 1);
  const ausForeign = computeFit({ profile: { goal: 'ausbildung', graduation: 'Аттестат другой страны' }, goal: 'ausbildung', link: okLink, details: emptyDetails({ education: 'Realschulabschluss' }), score: 85, pageAnalyzed: true, now: NOW });
  check('Ausbildung: иностранный аттестат → действие «проверь признание (anabin)»', ausForeign.fit.actions.some((a) => /anabin/.test(a)));
  const contract = computeFit({ profile: { goal: 'job', contract: 'Только бессрочный (unbefristet)' }, goal: 'job', link: okLink, details: emptyDetails({ employmentType: 'befristet / Zeitarbeit' }), score: 85, pageAnalyzed: true, now: NOW });
  check('договор: ищет бессрочный, а вакансия временная → пробел', contract.fit.gaps.some((g) => /бессрочн/.test(g)));
  const permit = computeFit({ profile: { goal: 'job', workPermit: 'Нужна виза для работы' }, goal: 'job', link: okLink, details: emptyDetails(), score: 85, pageAnalyzed: true, now: NOW });
  check('нужна виза → действие «уточни у работодателя»', permit.fit.actions.some((a) => /виз/.test(a)));

  // ---------- Хранение ----------
  const stored = JSON.stringify({ link: okLink, details: nd, fit: same.fit });
  const back = parseIntel(stored)!;
  check('parseIntel: круговой обмен без потерь', back.link.state === 'ok' && back.details?.deadline === '2026-12-31' && back.fit?.advice === 'apply');
  check('parseIntel: пусто, мусор и старые вакансии не ломают чтение', parseIntel(null) === null && parseIntel('') === null && parseIntel('{oops') === null && parseIntel('{"x":1}') === null);
  const txt = intelToText(back).join('\n');
  check('intelToText: ссылка, срок, рекомендация для агента', /Ссылка: проверена/.test(txt) && /Срок подачи: 2026-12-31/.test(txt) && /Рекомендация для этого человека: Откликайся/.test(txt) && /со страницы вакансии/.test(txt));

  // ---------- Реальный осмотр страниц (локальный сервер) ----------
  const server = http.createServer((req, res) => {
    const u = req.url || '/';
    if (u === '/ok') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(ldHtml('2026-12-31')); }
    else if (u === '/expired') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(ldHtml('2020-01-01')); }
    else if (u === '/gone') { res.writeHead(404).end('nope'); }
    else if (u === '/blocked') { res.writeHead(403).end('bot'); }
    else if (u === '/redir') { res.writeHead(301, { Location: '/ok' }).end(); }
    else if (u === '/home-redir') { res.writeHead(302, { Location: '/' }).end(); }
    else if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Startseite ' + 'x'.repeat(400) + '</body></html>'); }
    else if (u === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF'); }
    else if (u === '/slow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('late'); }, 2000); }
    else res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const T = { allowPrivate: true, timeoutMs: 600 };

  const blocked = await inspectPage(`${base}/ok`); // без allowPrivate: локальный адрес запрещён
  check('inspectPage: локальный адрес по умолчанию заблокирован', !blocked.reachable && blocked.error === 'blocked-host');
  const ok = await inspectPage(`${base}/ok`, T);
  check('inspectPage: страница 200 прочитана (html + текст)', ok.reachable && ok.httpStatus === 200 && !!ok.html?.includes('JobPosting') && (ok.text?.length ?? 0) > 100);
  check('inspectPage + assessLink: живая вакансия → ок', assessLink(`${base}/ok`, ok, NOW).link.state === 'ok');
  const exp = await inspectPage(`${base}/expired`, T);
  check('inspectPage + assessLink: срок в разметке истёк → неактуальна', assessLink(`${base}/expired`, exp, NOW).link.state === 'closed');
  const gone = await inspectPage(`${base}/gone`, T);
  check('inspectPage + assessLink: 404 → неактуальна', gone.httpStatus === 404 && assessLink(`${base}/gone`, gone, NOW).link.state === 'closed');
  const blk = await inspectPage(`${base}/blocked`, T);
  check('inspectPage + assessLink: 403 → «проверь сам»', blk.httpStatus === 403 && assessLink(`${base}/blocked`, blk, NOW).link.state === 'unverified');
  const redir = await inspectPage(`${base}/redir`, T);
  check('inspectPage: редирект на другую страницу прослеживается', redir.reachable && redir.finalUrl === `${base}/ok`);
  const homeR = await inspectPage(`${base}/home-redir`, T);
  check('inspectPage + assessLink: редирект на главную → «проверь сам»', assessLink(`${base}/home-redir`, homeR, NOW).link.state === 'unverified');
  const pdf = await inspectPage(`${base}/pdf`, T);
  check('inspectPage: не веб-страница → not-html', !pdf.reachable && pdf.error === 'not-html');
  const slow = await inspectPage(`${base}/slow`, { allowPrivate: true, timeoutMs: 300 });
  check('inspectPage: медленный сайт → таймаут, «проверь сам»', slow.error === 'timeout' && assessLink(`${base}/slow`, slow, NOW).link.state === 'unverified');
  const noConn = await inspectPage('http://127.0.0.1:1/x', { allowPrivate: true, timeoutMs: 600 });
  check('inspectPage: нет соединения → network', !noConn.reachable && noConn.error === 'network');

  server.closeAllConnections?.();
  server.close();
  console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ ВАКАНСИЙ ПРОЙДЕНЫ');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
