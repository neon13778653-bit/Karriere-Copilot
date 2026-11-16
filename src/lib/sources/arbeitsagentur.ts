// Официальная биржа вакансий Bundesagentur für Arbeit («Jobsuche»): актуальные вакансии и Ausbildung,
// с координатами и расстоянием. Публичный API без регистрации (заголовок X-API-Key: jobboerse-jobsuche,
// см. https://jobsuche.api.bund.dev/). Это самый надёжный источник: вакансия в выдаче = она сейчас опубликована.
//
// ВАЖНО: формат ответа разбирается осторожно (любое поле может отсутствовать), а любая ошибка превращается
// в пустой результат — тогда поиск продолжает работать через обычный веб-поиск.

import type { Goal } from '../types';

export const BA_BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4';
const BA_KEY = 'jobboerse-jobsuche';

export interface BaJob {
  refnr: string;
  title: string;
  employer?: string;
  profession?: string;
  location?: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
  postedAt?: string;
  startDate?: string;
  url: string;
}

export interface BaSearchParams {
  was: string; // профессия / ключевое слово
  wo?: string; // город
  umkreis?: number; // радиус, км
  goal: Goal;
  size?: number;
  veroeffentlichtseit?: number; // не старше N дней
}

/** BA принимает только фиксированные радиусы. Берём ближайший не меньше запрошенного. */
export function baRadius(km?: number | null): number | undefined {
  if (km == null || !Number.isFinite(km) || km <= 0) return undefined;
  const allowed = [5, 10, 15, 20, 25, 30, 50, 100, 200];
  return allowed.find((a) => a >= km) ?? 200;
}

export function buildBaSearchUrl(p: BaSearchParams): string {
  const q = new URLSearchParams();
  q.set('angebotsart', p.goal === 'ausbildung' ? '4' : '1'); // 4 = Ausbildung / duales Studium, 1 = Arbeit
  q.set('was', p.was);
  if (p.wo) q.set('wo', p.wo);
  const r = baRadius(p.umkreis);
  if (p.wo && r) q.set('umkreis', String(r));
  q.set('veroeffentlichtseit', String(p.veroeffentlichtseit ?? 60));
  q.set('size', String(p.size ?? 25));
  q.set('page', '1');
  return `${BA_BASE}/jobs?${q.toString()}`;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function baJobUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}`;
}

/** Разбор ответа поиска. Любой мусор вместо JSON даёт пустой список. */
export function parseBaSearch(json: unknown): BaJob[] {
  const list = (json as { stellenangebote?: unknown })?.stellenangebote;
  if (!Array.isArray(list)) return [];
  const out: BaJob[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const refnr = asStr(o.refnr);
    const title = asStr(o.titel) ?? asStr(o.beruf);
    if (!refnr || !title) continue;
    const ort = (o.arbeitsort && typeof o.arbeitsort === 'object' ? o.arbeitsort : {}) as Record<string, unknown>;
    const koord = (ort.koordinaten && typeof ort.koordinaten === 'object' ? ort.koordinaten : {}) as Record<string, unknown>;
    const loc = [asStr(ort.plz), asStr(ort.ort)].filter(Boolean).join(' ') || asStr(ort.region);
    out.push({
      refnr,
      title,
      employer: asStr(o.arbeitgeber),
      profession: asStr(o.beruf),
      location: loc,
      lat: asNum(koord.lat),
      lon: asNum(koord.lon),
      distanceKm: asNum(ort.entfernung),
      postedAt: asStr(o.aktuelleVeroeffentlichungsdatum) ?? asStr(o.modifikationsTimestamp),
      startDate: asStr(o.eintrittsdatum),
      url: baJobUrl(refnr),
    });
  }
  return out;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DETAIL_FIELDS: [string, string][] = [
  ['titel', 'Должность'],
  ['firma', 'Работодатель'],
  ['stellenbeschreibung', 'Описание'],
  ['verguetungsangabe', 'Оплата'],
  ['eintrittsdatum', 'Начало'],
  ['befristung', 'Договор'],
  ['arbeitszeitmodelle', 'График'],
  ['hauptberuf', 'Профессия'],
  ['fuerBewerbungenAnsprechpartner', 'Контакт'],
  ['anforderungen', 'Требования'],
];

/** Текст страницы вакансии из ответа API деталей — так же читается ИИ, как обычная страница. */
export function parseBaDetails(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const o = json as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, label] of DETAIL_FIELDS) {
    const v = o[key];
    const text = Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').join(', ')
      : typeof v === 'string'
        ? v
        : '';
    const t = stripHtml(text);
    if (t) lines.push(`${label}: ${t}`);
  }
  return lines.join('\n');
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

async function baGet(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { 'X-API-Key': BA_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Arbeitsagentur HTTP ${res.status}`);
  return res.json();
}

export async function searchArbeitsagentur(
  p: BaSearchParams,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ jobs: BaJob[]; error?: string }> {
  try {
    const json = await baGet(buildBaSearchUrl(p), fetchImpl);
    return { jobs: parseBaSearch(json) };
  } catch (e) {
    return { jobs: [], error: e instanceof Error ? e.message : 'неизвестная ошибка' };
  }
}

/** Текст деталей вакансии; null, если не получилось. */
export async function fetchBaDetails(
  refnr: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string | null> {
  try {
    const id = Buffer.from(refnr, 'utf8').toString('base64');
    const json = await baGet(`${BA_BASE}/jobdetails/${id}`, fetchImpl);
    const text = parseBaDetails(json);
    return text || null;
  } catch {
    return null;
  }
}
