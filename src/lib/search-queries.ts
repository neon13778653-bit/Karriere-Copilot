// Поисковые запросы: детерминированная основа + дополнение от ИИ.
// Раньше запросы целиком придумывал ИИ (temperature 0.3), и выдача плавала от запуска к запуску.
// Теперь основа строится кодом по шаблонам с `site:` на реальные порталы, ИИ лишь добавляет варианты.

import { findCity, isAnywhere } from './geo';
import { germanRank } from './vacancy-intel';
import type { Goal } from './types';

/** Ausbildung стартует в августе–сентябре: с октября осмысленно искать места на следующий год. */
export function ausbildungStartYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

const LATIN = /[A-Za-zÄÖÜäöüß]{3}/;
const CYRILLIC = /[А-Яа-яЁё]{3}/;

/** Короткий немецкий термин для запроса из названия направления; null, если названия на другом языке. */
export function searchTerm(d: { name?: string; keywords?: string[] }): string | null {
  for (const raw of [d.name, ...(d.keywords ?? [])]) {
    if (typeof raw !== 'string') continue;
    const t = raw
      .replace(/["«»]/g, '')
      .replace(/\(\s*[mwfdx*]\s*[/|]\s*[mwfdx*](\s*[/|]\s*[mwfdx*])?\s*\)/gi, '')
      .replace(/^\s*ausbildung\s+(zum|zur|als|im|in der|in)\s+/i, '')
      .replace(/(\/|\*|:)-?in\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || !LATIN.test(t) || CYRILLIC.test(t) || t.split(' ').length > 5) continue;
    return t;
  }
  return null;
}

/** Город для запроса: немецкое название; для «вся Германия» и неизвестных кириллических названий — пусто. */
export function queryCity(city?: string | null): string {
  if (!city || isAnywhere(city)) return '';
  const found = findCity(city);
  if (found) return found.name;
  return LATIN.test(city) && !CYRILLIC.test(city) ? city.trim() : '';
}

export interface QueryInput {
  goal: Goal;
  terms: string[];
  city?: string | null;
  germanLevel?: string | null;
  now?: Date;
  limit: number;
}

function ausbildungTemplates(t: string, c: string, year: number): string[] {
  return [
    `Ausbildung ${t} ${c} ${year}`,
    `${t} Ausbildung ${c} site:ausbildung.de`,
    `Ausbildung ${t} ${c} site:arbeitsagentur.de`,
    `${t} Azubi ${c} site:azubiyo.de`,
    `Ausbildung ${t} ${c} Karriere "jetzt bewerben"`,
    `${t} Ausbildungsplatz ${c} site:aubi-plus.de`,
  ];
}

function jobTemplates(t: string, c: string): string[] {
  return [
    `${t} Stellenangebote ${c}`,
    `${t} Jobs ${c} site:arbeitsagentur.de`,
    `${t} ${c} site:stepstone.de`,
    `${t} (m/w/d) ${c} Karriere "Wir suchen"`,
    `${t} Jobs ${c} site:de.indeed.com`,
    `${t} ${c} site:kimeta.de`,
  ];
}

function tidy(q: string): string {
  return q.replace(/\s+/g, ' ').trim();
}

/** Детерминированные запросы: одинаковый профиль → одинаковый список. Шаблоны чередуются по направлениям. */
export function buildQueries(inp: QueryInput): string[] {
  const city = queryCity(inp.city);
  const year = ausbildungStartYear(inp.now);
  const terms = inp.terms.filter(Boolean);
  const perTerm = terms.map((t) =>
    inp.goal === 'ausbildung' ? ausbildungTemplates(t, city, year) : jobTemplates(t, city),
  );

  const out: string[] = [];
  const add = (q: string) => {
    const t = tidy(q);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  const depth = perTerm[0]?.length ?? 0;
  for (let i = 0; i < depth; i++) for (const tpl of perTerm) add(tpl[i]);

  // слабый немецкий: добавляем запросы для тех, кому нужен мягкий вход
  const rank = germanRank(inp.germanLevel);
  if (terms[0] && rank != null && rank <= 3) {
    if (inp.goal === 'job') add(`English speaking ${terms[0]} ${city}`);
    else add(`Einstiegsqualifizierung ${terms[0]} ${city}`);
  }
  return out.slice(0, Math.max(0, inp.limit));
}

/** Запросы «пошире» — когда по основным нашлось слишком мало: без города и без привязки к порталам. */
export function buildBroadQueries(goal: Goal, terms: string[], now: Date = new Date(), limit = 3): string[] {
  const year = ausbildungStartYear(now);
  const out: string[] = [];
  for (const t of terms.slice(0, 2)) {
    if (goal === 'ausbildung') {
      out.push(tidy(`Ausbildung ${t} ${year}`), tidy(`${t} Ausbildungsplatz freie Stellen`));
    } else {
      out.push(tidy(`${t} Stellenangebote Deutschland`), tidy(`${t} (m/w/d) Vollzeit Jobs`));
    }
  }
  return [...new Set(out)].slice(0, limit);
}

/** Основа + запросы ИИ без повторов, не больше total. */
export function mergeQueries(base: string[], extra: string[], total: number): string[] {
  const out: string[] = [];
  for (const q of [...base, ...extra]) {
    const t = tidy(q);
    if (t.length > 3 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= total) break;
  }
  return out;
}
