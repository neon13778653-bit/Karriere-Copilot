// Веб-слой агента: поиск вакансий и чтение страниц.
//
// Провайдеры поиска (по приоритету, при пустом ответе пробуется следующий):
//   1) SearXNG  — SEARXNG_URL=http://localhost:8080 (в настройках SearXNG должен быть включён формат json)
//   2) Brave    — BRAVE_API_KEY=...
//   3) z-ai SDK — только если найден .z-ai-config (рабочая среда разработки)
// Без единого провайдера поиск вакансий недоступен — и приложение говорит об этом прямо.

import dns from 'node:dns/promises';
import net from 'node:net';
import { getZai, withTimeout, zaiConfigured } from './llm';
import type { PageInspection } from './vacancy-intel';

export interface WebHit {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
}

export type SearchProviderId = 'searxng' | 'brave' | 'zai' | 'none';

function searxngUrl(): string | null {
  const u = (process.env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : null;
}

function braveKey(): string | null {
  return (process.env.BRAVE_API_KEY || '').trim() || null;
}

/** Какой поисковый провайдер будет использован первым (для диагностики в интерфейсе). */
export function searchMode(): SearchProviderId {
  if (searxngUrl()) return 'searxng';
  if (braveKey()) return 'brave';
  if (zaiConfigured()) return 'zai';
  return 'none';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function toHits(
  items: { url?: unknown; title?: unknown; snippet?: unknown }[],
  num: number,
): WebHit[] {
  const hits: WebHit[] = [];
  for (const it of items) {
    const url = typeof it.url === 'string' ? it.url : '';
    if (!/^https?:\/\//.test(url)) continue;
    hits.push({
      url,
      name: typeof it.title === 'string' ? it.title : url,
      snippet: typeof it.snippet === 'string' ? it.snippet : '',
      host_name: hostOf(url),
      rank: hits.length + 1,
    });
    if (hits.length >= num) break;
  }
  return hits;
}

async function searchSearxng(base: string, query: string, num: number): Promise<WebHit[]> {
  const params = new URLSearchParams({ q: query, format: 'json', language: 'de', safesearch: '0' });
  const res = await fetch(`${base}/search?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const json: any = await res.json();
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  return toHits(
    results.map((r) => ({ url: r?.url, title: r?.title, snippet: r?.content })),
    num,
  );
}

async function searchBrave(key: string, query: string, num: number): Promise<WebHit[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(num, 1), 20)),
    country: 'de',
    search_lang: 'de',
  });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const json: any = await res.json();
  const results: any[] = Array.isArray(json?.web?.results) ? json.web.results : [];
  return toHits(
    results.map((r) => ({ url: r?.url, title: r?.title, snippet: r?.description })),
    num,
  );
}

async function searchZai(query: string, num: number): Promise<WebHit[]> {
  const zai = await getZai();
  const results: any = await withTimeout(zai.functions.invoke('web_search', { query, num }), 45_000);
  return Array.isArray(results) ? (results as WebHit[]) : [];
}

/** Реальный веб-поиск. Возвращает [] (а не бросает), если ни один провайдер не дал результатов. */
export async function webSearch(query: string, num = 8): Promise<WebHit[]> {
  const attempts: (() => Promise<WebHit[]>)[] = [];
  const sx = searxngUrl();
  if (sx) attempts.push(() => searchSearxng(sx, query, num));
  const bk = braveKey();
  if (bk) attempts.push(() => searchBrave(bk, query, num));
  if (zaiConfigured()) attempts.push(() => searchZai(query, num));

  for (const run of attempts) {
    try {
      const hits = await run();
      if (hits.length) return hits;
    } catch {
      // провайдер недоступен — пробуем следующий
    }
  }
  return [];
}

// ---------- Чтение страниц ----------

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, облачные metadata-адреса
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === '::' || low === '::1') return true;
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb');
  }
  return true; // не IP — считаем небезопасным
}

/** URL приходит из интернета (результаты поиска), поэтому в локальную сеть и на localhost ходить нельзя. */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('только http/https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('адрес не публичный');
    return url;
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('адрес не публичный');
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('адрес не публичный');
  return url;
}

const MAX_PAGE_BYTES = 1_500_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; KarriereCopilot/0.6)',
  Accept: 'text/html,text/plain;q=0.9',
  'Accept-Language': 'de,en;q=0.8,ru;q=0.5',
};

/**
 * Осмотр страницы вакансии: код ответа, адрес после редиректов, HTML и текст.
 * Не бросает исключений: любой сбой описан в результате (reachable=false + error/httpStatus).
 * allowPrivate нужен только тестам с локальным сервером; в приложении адрес всегда проверяется как публичный.
 */
export async function inspectPage(
  rawUrl: string,
  opts: { allowPrivate?: boolean; timeoutMs?: number } = {},
): Promise<PageInspection> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const check = async (u: string): Promise<URL> => (opts.allowPrivate ? new URL(u) : assertPublicHttpUrl(u));

  let current: URL;
  try {
    current = await check(rawUrl);
  } catch {
    return { reachable: false, error: 'blocked-host' };
  }

  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { reachable: false, error: timedOut ? 'timeout' : 'network', finalUrl: current.toString() };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      res.body?.cancel().catch(() => undefined);
      if (!loc) return { reachable: false, httpStatus: res.status, finalUrl: current.toString() };
      try {
        current = await check(new URL(loc, current).toString()); // каждый редирект проверяем заново
      } catch {
        return { reachable: false, error: 'blocked-host', finalUrl: current.toString() };
      }
      continue;
    }

    if (!res.ok || !res.body) {
      res.body?.cancel().catch(() => undefined);
      return { reachable: false, httpStatus: res.status, finalUrl: current.toString() };
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/(html|plain)|application\/xhtml/i.test(type)) {
      res.body.cancel().catch(() => undefined);
      return { reachable: false, httpStatus: res.status, error: 'not-html', finalUrl: current.toString() };
    }

    try {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_PAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      reader.cancel().catch(() => undefined);
      const html = Buffer.concat(chunks).toString('utf8');
      return {
        reachable: true,
        httpStatus: res.status,
        finalUrl: current.toString(),
        html,
        text: htmlToText(html).slice(0, 20_000),
      };
    } catch {
      return { reachable: false, httpStatus: res.status, error: 'network', finalUrl: current.toString() };
    }
  }
  return { reachable: false, error: 'redirects', finalUrl: current.toString() };
}

async function fetchPageDirect(rawUrl: string): Promise<string | null> {
  const ins = await inspectPage(rawUrl);
  return ins.reachable && ins.text ? ins.text.slice(0, 4000) || null : null;
}

/** Чтение страницы (для MAX-режима: смотрим описание вакансии на сайте компании). */
export async function readPage(url: string): Promise<string | null> {
  if (zaiConfigured()) {
    try {
      const zai = await getZai();
      const res: any = await withTimeout(zai.functions.invoke('page_reader', { url }), 20_000);
      const html: string = res?.data?.html || '';
      const text = html ? htmlToText(html).slice(0, 4000) : '';
      if (text) return text;
    } catch {
      // уходим на прямое чтение
    }
  }
  try {
    return await fetchPageDirect(url);
  } catch {
    return null;
  }
}
