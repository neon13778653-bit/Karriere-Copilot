// Качество выдачи (чистая логика): что отсеять до ИИ, как склеить дубли, чем доверять и как считать оценку стабильно.
//
// Идея: ИИ хорош в «понять смысл вакансии», но плох в стабильных числах. Поэтому:
//   1) мусор (соцсети, списки «1 234 вакансии…», статьи про зарплату) убирается правилами ДО ИИ — дешевле и точнее;
//   2) ИИ ставит не «оценку 0–100», а грубые ступени (relevance 0–4), число считает код — оценка воспроизводима;
//   3) одна вакансия на нескольких порталах схлопывается в одну (оставляем самый надёжный источник).

import { parseDateLoose } from './vacancy-intel';

/* ------------------------------ Адреса и источники ------------------------------ */

const TRACKING_PARAM = /^(utm_|gclid|fbclid|msclkid|mc_|ref$|referrer$|source$|src$|trk|tracking|campaign|cid$|sid$|_ga)/i;

/** Один и тот же адрес без трекинга, www, фрагмента и хвостового слэша. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
    params.sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
    const pathname = u.pathname.replace(/\/+$/, '') || '';
    return `${host}${pathname}${qs}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export type HitKind = 'official' | 'direct' | 'portal' | 'other';

const OFFICIAL = ['arbeitsagentur.de', 'interamt.de', 'service.bund.de', 'bewerbung.bund.de', 'lehrstellen-radar.de', 'ihk-lehrstellenboerse.de'];
const PORTALS = [
  'stepstone.de', 'indeed.com', 'xing.com', 'linkedin.com', 'jobware.de', 'kimeta.de', 'meinestadt.de', 'monster.de',
  'stellenanzeigen.de', 'jobs.de', 'jobvector.de', 'get-in-it.de', 'ausbildung.de', 'azubiyo.de', 'aubi-plus.de',
  'ausbildungsportal.de', 'azubi.de', 'ausbildungsstellen.de', 'karriere.at', 'jobsuche.de', 'joblift.de', 'jooble.org',
];
const BLOCKED = [
  'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'reddit.com',
  'pinterest.com', 'pinterest.de', 'wikipedia.org', 'wikihow.com', 'quora.com', 'gutefrage.net', 'kununu.com',
  'glassdoor.com', 'glassdoor.de', 'medium.com', 'duden.de', 'dict.cc', 'linguee.de', 'amazon.de', 'amazon.com',
  'ebay.de', 'spotify.com', 'scribd.com', 'slideshare.net',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostIn(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith('.' + d));
}

export function classifyHost(url: string): HitKind {
  const host = hostOf(url);
  if (hostIn(host, OFFICIAL)) return 'official';
  if (hostIn(host, PORTALS)) return 'portal';
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    // оставляем пустым
  }
  if (/karriere|career|jobs?\b|stellen|bewerb|ausbildung|azubi/i.test(host + path)) return 'direct';
  return 'other';
}

const TRUST: Record<HitKind, number> = { official: 1, direct: 0.9, portal: 0.7, other: 0.5 };
export function trustOf(kind: HitKind): number {
  return TRUST[kind];
}

/* ------------------------------ Предфильтр результатов поиска ------------------------------ */

const NUM = String.raw`\d{1,3}(?:[.,\s]\d{3})*|\d+`;
const LISTING_WORD = String.raw`(?:stellenangebote|stellen|jobs|ausbildungspl(?:ä|ae)tze|ausbildungsstellen|lehrstellen|ausbildungsangebote|azubi[\s-]*jobs|vakanzen|ausbildungen?)`;
const LISTING_TITLE: RegExp[] = [
  // «1.234 Fachinformatiker Stellenangebote in Köln», «273 Ausbildungsplätze als …» — число, до 4 слов, слово-«список»
  new RegExp(String.raw`^\s*(?:über\s+|ca\.\s+)?(?:${NUM})\+?\s+(?:\S+\s+){0,4}?${LISTING_WORD}\b`, 'i'),
  // «… (1.234 offene Stellen)» где угодно в заголовке
  new RegExp(String.raw`\b(?:${NUM})\+?\s+(?:aktuelle\s+|offene\s+|freie\s+)${LISTING_WORD}\b`, 'i'),
  /\b(top|beste[rn]?)\s+\d+\b/i,
  /^\s*(alle\s+)?(aktuellen?\s+)?(stellenangebote|jobs|ausbildungspl(ä|ae)tze|ausbildungsstellen|lehrstellen|ausbildung)\s+(in|für|als|bei)\s+\S+\s*$/i,
];
const INFO_TITLE = /\b(gehalt|verdienst|gehaltsvergleich|was verdient|berufsbild|so wirst du|ratgeber|erfahrungen|bewertungen?|tipps?|vorlage|muster)\b/i;
const INFO_PATH = /\/(ratgeber|magazin|blog|lexikon|karriere-?tipps?|berufe?|berufsbilder|wiki|news|presse)\b/i;

export type DropReason = 'blocked-domain' | 'listing' | 'info' | 'duplicate' | 'bad-url';

export function dropReasonFor(hit: { url: string; name?: string; snippet?: string }): DropReason | null {
  const host = hostOf(hit.url);
  if (!host) return 'bad-url';
  if (hostIn(host, BLOCKED)) return 'blocked-domain';
  const title = hit.name || '';
  if (LISTING_TITLE.some((re) => re.test(title))) return 'listing';
  let path = '';
  try {
    path = new URL(hit.url).pathname;
  } catch {
    // уже проверено выше
  }
  if (INFO_PATH.test(path) && !/jobdetail|stellenangebot|vacanc/i.test(path)) return 'info';
  if (INFO_TITLE.test(title) && !/\((m|w|f|d)\s*[/|]/i.test(title)) return 'info';
  return null;
}

export interface FilteredHit<T> {
  hit: T;
  kind: HitKind;
  trust: number;
}

/**
 * Убирает заведомый мусор и дубли адресов. Если осталось слишком мало (minKeep), возвращает часть отсеянных
 * «списков и статей» обратно: лучше показать с оговоркой, чем остаться без результатов. Заблокированные домены — никогда.
 */
export function preFilterHits<T extends { url: string; name?: string; snippet?: string }>(
  hits: T[],
  opts: { minKeep?: number } = {},
): { kept: FilteredHit<T>[]; dropped: { reason: DropReason; url: string }[] } {
  const kept: FilteredHit<T>[] = [];
  const dropped: { reason: DropReason; url: string }[] = [];
  const reserve: FilteredHit<T>[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const key = canonicalUrl(hit.url);
    if (seen.has(key)) {
      dropped.push({ reason: 'duplicate', url: hit.url });
      continue;
    }
    seen.add(key);
    const reason = dropReasonFor(hit);
    const kind = classifyHost(hit.url);
    const entry = { hit, kind, trust: TRUST[kind] };
    if (!reason) kept.push(entry);
    else {
      dropped.push({ reason, url: hit.url });
      if (reason === 'listing' || reason === 'info') reserve.push(entry);
    }
  }

  const minKeep = opts.minKeep ?? 0;
  for (let i = 0; kept.length < minKeep && i < reserve.length; i++) kept.push(reserve[i]);
  return { kept, dropped };
}

/* ------------------------------ Дубли одной вакансии на разных порталах ------------------------------ */

const GENDER_RE = /\(?\s*[mwfdx*]\s*[/|:]\s*[mwfdx*](\s*[/|:]\s*[mwfdx*])?\s*\)?/gi;
const FILLER = new Set(['ausbildung', 'zum', 'zur', 'als', 'job', 'jobs', 'stelle', 'stellenangebot', 'duales', 'studium', 'in', 'und', 'der', 'die', 'das', 'für', 'bei', 'ab', 'gn', 'in']);

function tokens(s: string): Set<string> {
  const t = s
    .toLowerCase()
    .replace(GENDER_RE, ' ')
    .replace(/\/in\b|\*in\b|:in\b|innen\b/g, ' ')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d{4}$/.test(w));
  return new Set(t);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function companyKey(c?: string | null): string {
  return (c || '').toLowerCase().replace(/\b(gmbh|ag|se|kg|ohg|ug|e\.?v\.?|mbh|co|&)\b/g, ' ').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
}

export interface DedupeItem {
  title: string;
  company?: string | null;
  location?: string | null;
  trust?: number;
  score?: number | null;
}

/**
 * Склеивает дубли: та же должность у той же компании в том же городе. Без названия компании не склеиваем
 * (слишком велик риск слить разные вакансии). Среди дублей остаётся источник с большим доверием, затем с большей оценкой.
 */
export function dedupeVacancies<T extends DedupeItem>(items: T[]): { kept: T[]; removed: number } {
  const groups: { rep: T; tok: Set<string>; comp: string; city: string }[] = [];
  const better = (a: T, b: T) =>
    (a.trust ?? 0.5) !== (b.trust ?? 0.5) ? (a.trust ?? 0.5) > (b.trust ?? 0.5) : (a.score ?? 0) > (b.score ?? 0);
  let removed = 0;
  const order: T[] = [];
  for (const it of items) {
    const comp = companyKey(it.company);
    if (!comp) {
      order.push(it);
      continue;
    }
    const tok = tokens(it.title);
    const city = (it.location || '').toLowerCase().replace(/[^a-zäöüß]+/g, ' ').trim().split(' ')[0] || '';
    const g = groups.find((x) => x.comp === comp && (!x.city || !city || x.city === city) && jaccard(x.tok, tok) >= 0.75);
    if (!g) {
      groups.push({ rep: it, tok, comp, city });
      order.push(it);
    } else {
      removed++;
      if (better(it, g.rep)) {
        order[order.indexOf(g.rep)] = it;
        g.rep = it;
      }
    }
  }
  return { kept: order, removed };
}

/** Ограничивает число вакансий от одной компании, чтобы список не состоял из одного работодателя. */
export function diversify<T extends { company?: string | null }>(items: T[], perCompany = 3): T[] {
  const count = new Map<string, number>();
  return items.filter((it) => {
    const k = companyKey(it.company);
    if (!k) return true;
    const n = (count.get(k) ?? 0) + 1;
    count.set(k, n);
    return n <= perCompany;
  });
}

/* ------------------------------ Стабильная оценка ------------------------------ */

/** Ступени соответствия, которые ставит ИИ: грубая шкала даёт меньше разброса, чем «число от 0 до 100». */
export const RELEVANCE_SCALE = '0 — не по профессии/направлению, 1 — смежное, 2 — близко, 3 — хорошо подходит, 4 — точное попадание';
export const REQUIREMENTS_SCALE = '0 — не выполняет ключевые требования, 1 — многого не хватает, 2 — частично, 3 — почти всё, 4 — полностью';

const BASE_BY_RELEVANCE = [8, 30, 52, 74, 90];
const REQ_ADJ = [-24, -12, -3, 3, 8];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface StableScoreInput {
  relevance?: number | null; // 0–4, от ИИ по заголовку и описанию
  requirementsFit?: number | null; // 0–4, от ИИ по полному тексту страницы
  locationDelta?: number; // из locationFit (≤ 0)
  trust?: number; // из trustOf
  ageDays?: number | null; // возраст публикации
  llmScore?: number | null; // «сырая» оценка ИИ 0–100 (даёт лишь 20% веса)
}

/** Оценка 0–100, воспроизводимая при тех же входных данных. null — не из чего считать. */
export function stableScore(inp: StableScoreInput): number | null {
  const loc = inp.locationDelta ?? 0;
  const trustAdj = Math.round(((inp.trust ?? 0.5) - 0.5) * 8);
  const ageAdj = inp.ageDays == null ? 0 : inp.ageDays > 90 ? -8 : inp.ageDays > 60 ? -5 : inp.ageDays > 30 ? -2 : 0;
  const llm = typeof inp.llmScore === 'number' ? clamp(inp.llmScore, 0, 100) : null;

  if (typeof inp.relevance !== 'number') {
    if (llm == null) return null;
    return clamp(Math.round(llm + loc + trustAdj + ageAdj), 0, 100);
  }
  let rubric = BASE_BY_RELEVANCE[clamp(Math.round(inp.relevance), 0, 4)];
  if (typeof inp.requirementsFit === 'number') rubric += REQ_ADJ[clamp(Math.round(inp.requirementsFit), 0, 4)];
  rubric += loc + trustAdj + ageAdj;
  const blended = llm == null ? rubric : 0.8 * rubric + 0.2 * llm;
  return clamp(Math.round(blended), 0, 100);
}

/** Сколько дней прошло с публикации (по строке даты); null, если даты нет. */
export function ageInDays(postedAt?: string | null, now: Date = new Date()): number | null {
  const d = parseDateLoose(postedAt);
  if (!d) return null;
  // считаем по календарным дням (parseDateLoose даёт конец суток — для сроков подачи это верно, для возраста нет)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - day) / 86_400_000));
}
