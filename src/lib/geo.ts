// География поиска: расстояние от города человека до места вакансии.
// Без внешних сервисов: встроенная таблица ~110 крупнейших городов Германии (приблизительные координаты центров).
// Для мелких городов расстояние неизвестно — тогда вакансия не штрафуется (честнее, чем гадать).

import type { UserProfile } from './types';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface City extends GeoPoint {
  name: string; // каноническое немецкое название
}

// [название, широта, долгота, синонимы (латиницей/кириллицей, без диакритики нормализуются автоматически)]
const CITY_TABLE: [string, number, number, string[]?][] = [
  ['Berlin', 52.52, 13.405, ['берлин']],
  ['Hamburg', 53.551, 9.994, ['гамбург']],
  ['München', 48.137, 11.575, ['munich', 'muenchen', 'мюнхен']],
  ['Köln', 50.938, 6.96, ['koeln', 'cologne', 'кёльн', 'кельн']],
  ['Frankfurt am Main', 50.11, 8.682, ['frankfurt', 'frankfurt a m', 'frankfurt main', 'франкфурт', 'франкфурт на майне', 'франкфурт-на-майне']],
  ['Stuttgart', 48.775, 9.182, ['штутгарт']],
  ['Düsseldorf', 51.227, 6.774, ['duesseldorf', 'дюссельдорф']],
  ['Dortmund', 51.514, 7.468, ['дортмунд']],
  ['Essen', 51.456, 7.012, ['эссен']],
  ['Leipzig', 51.34, 12.375, ['лейпциг']],
  ['Bremen', 53.079, 8.802, ['бремен']],
  ['Dresden', 51.05, 13.738, ['дрезден']],
  ['Hannover', 52.375, 9.732, ['hanover', 'ганновер']],
  ['Nürnberg', 49.452, 11.077, ['nuernberg', 'nuremberg', 'нюрнберг']],
  ['Duisburg', 51.435, 6.763, ['дуйсбург']],
  ['Bochum', 51.482, 7.216, ['бохум']],
  ['Wuppertal', 51.256, 7.15, ['вупперталь']],
  ['Bielefeld', 52.021, 8.533, ['билефельд']],
  ['Bonn', 50.737, 7.098, ['бонн']],
  ['Münster', 51.961, 7.628, ['muenster', 'мюнстер']],
  ['Karlsruhe', 49.007, 8.404, ['карлсруэ']],
  ['Mannheim', 49.488, 8.466, ['маннгейм']],
  ['Augsburg', 48.371, 10.898, ['аугсбург']],
  ['Wiesbaden', 50.083, 8.24, ['висбаден']],
  ['Gelsenkirchen', 51.517, 7.086],
  ['Mönchengladbach', 51.195, 6.442, ['moenchengladbach']],
  ['Braunschweig', 52.269, 10.521, ['брауншвейг']],
  ['Chemnitz', 50.833, 12.92, ['хемниц']],
  ['Kiel', 54.323, 10.123, ['киль']],
  ['Aachen', 50.776, 6.084, ['ахен']],
  ['Halle (Saale)', 51.483, 11.97, ['halle', 'halle saale', 'галле']],
  ['Magdeburg', 52.131, 11.64, ['магдебург']],
  ['Freiburg', 47.999, 7.842, ['freiburg im breisgau', 'фрайбург']],
  ['Krefeld', 51.339, 6.585],
  ['Lübeck', 53.866, 10.687, ['luebeck', 'любек']],
  ['Oberhausen', 51.47, 6.852],
  ['Erfurt', 50.978, 11.029, ['эрфурт']],
  ['Mainz', 49.999, 8.271, ['майнц']],
  ['Rostock', 54.092, 12.099, ['росток']],
  ['Kassel', 51.313, 9.48, ['кассель']],
  ['Hagen', 51.361, 7.474],
  ['Hamm', 51.681, 7.815],
  ['Saarbrücken', 49.24, 6.997, ['saarbruecken', 'саарбрюккен']],
  ['Mülheim an der Ruhr', 51.431, 6.883, ['muelheim', 'mulheim', 'mülheim']],
  ['Potsdam', 52.391, 13.065, ['потсдам']],
  ['Ludwigshafen', 49.477, 8.445, ['ludwigshafen am rhein']],
  ['Oldenburg', 53.143, 8.214],
  ['Leverkusen', 51.033, 6.984],
  ['Osnabrück', 52.279, 8.047, ['osnabrueck']],
  ['Solingen', 51.171, 7.083],
  ['Heidelberg', 49.399, 8.673, ['гейдельберг']],
  ['Herne', 51.538, 7.225],
  ['Neuss', 51.204, 6.688],
  ['Darmstadt', 49.873, 8.651, ['дармштадт']],
  ['Paderborn', 51.719, 8.754],
  ['Regensburg', 49.013, 12.102, ['регенсбург']],
  ['Ingolstadt', 48.763, 11.425],
  ['Würzburg', 49.792, 9.953, ['wuerzburg', 'вюрцбург']],
  ['Fürth', 49.477, 10.989, ['fuerth']],
  ['Wolfsburg', 52.423, 10.787, ['вольфсбург']],
  ['Offenbach am Main', 50.096, 8.766, ['offenbach']],
  ['Ulm', 48.399, 9.992, ['ульм']],
  ['Heilbronn', 49.142, 9.219],
  ['Pforzheim', 48.892, 8.694],
  ['Göttingen', 51.541, 9.916, ['goettingen', 'гёттинген']],
  ['Bottrop', 51.524, 6.929],
  ['Trier', 49.757, 6.642, ['трир']],
  ['Recklinghausen', 51.614, 7.198],
  ['Reutlingen', 48.492, 9.205],
  ['Bremerhaven', 53.54, 8.581],
  ['Koblenz', 50.36, 7.589, ['кобленц']],
  ['Bergisch Gladbach', 50.992, 7.129],
  ['Jena', 50.927, 11.589, ['йена']],
  ['Remscheid', 51.179, 7.193],
  ['Erlangen', 49.59, 11.004, ['эрланген']],
  ['Moers', 51.451, 6.626],
  ['Siegen', 50.875, 8.024],
  ['Hildesheim', 52.151, 9.951],
  ['Salzgitter', 52.15, 10.359],
  ['Cottbus', 51.757, 14.329],
  ['Konstanz', 47.663, 9.175, ['констанц']],
  ['Flensburg', 54.782, 9.436],
  ['Gießen', 50.587, 8.678, ['giessen']],
  ['Schwerin', 53.636, 11.401],
  ['Zwickau', 50.718, 12.492],
  ['Dessau-Roßlau', 51.838, 12.246, ['dessau', 'dessau rosslau']],
  ['Witten', 51.443, 7.352],
  ['Gera', 50.881, 12.083],
  ['Iserlohn', 51.375, 7.7],
  ['Ratingen', 51.297, 6.85],
  ['Lüneburg', 53.249, 10.407, ['lueneburg']],
  ['Hanau', 50.133, 8.918],
  ['Esslingen am Neckar', 48.739, 9.305, ['esslingen']],
  ['Marl', 51.656, 7.09],
  ['Velbert', 51.34, 7.044],
  ['Minden', 52.289, 8.917],
  ['Villingen-Schwenningen', 48.06, 8.46],
  ['Worms', 49.633, 8.36],
  ['Tübingen', 48.521, 9.054, ['tuebingen', 'тюбинген']],
  ['Neu-Isenburg', 50.055, 8.696],
  ['Rüsselsheim am Main', 49.989, 8.413, ['ruesselsheim', 'rüsselsheim']],
  ['Bad Homburg vor der Höhe', 50.227, 8.618, ['bad homburg']],
  ['Dreieich', 50.019, 8.704],
  ['Langen (Hessen)', 49.99, 8.67, ['langen hessen']],
  ['Aschaffenburg', 49.976, 9.149],
  ['Bamberg', 49.892, 10.887, ['бамберг']],
  ['Bayreuth', 49.943, 11.575],
  ['Passau', 48.574, 13.464],
  ['Landshut', 48.537, 12.152],
  ['Rosenheim', 47.856, 12.128],
  ['Kempten', 47.727, 10.311],
  ['Friedrichshafen', 47.654, 9.479],
  ['Ravensburg', 47.781, 9.612],
  ['Stralsund', 54.309, 13.081],
  ['Greifswald', 54.093, 13.381],
  ['Neubrandenburg', 53.557, 13.261],
  ['Wismar', 53.893, 11.466],
  ['Brandenburg an der Havel', 52.412, 12.532, ['brandenburg']],
  ['Frankfurt (Oder)', 52.347, 14.55, ['frankfurt oder']],
  ['Görlitz', 51.153, 14.987, ['goerlitz']],
  ['Plauen', 50.497, 12.138],
  ['Fulda', 50.552, 9.676],
  ['Marburg', 50.81, 8.77],
  ['Wetzlar', 50.557, 8.502],
  ['Bad Kreuznach', 49.842, 7.867],
  ['Kaiserslautern', 49.444, 7.769],
  ['Neustadt an der Weinstraße', 49.35, 8.14],
  ['Speyer', 49.318, 8.431],
  ['Landau in der Pfalz', 49.199, 8.118],
  ['Baden-Baden', 48.762, 8.24],
  ['Offenburg', 48.473, 7.944],
  ['Lörrach', 47.616, 7.661, ['loerrach']],
];

/** Нормализация: нижний регистр, без диакритики, ß→ss, дефисы и знаки → пробелы. */
export function normGeo(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // диакритика (ü→u, ö→o, ä→a); й и ё в кириллице тоже схлопываются
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

interface IndexEntry {
  alias: string;
  city: City;
}

const INDEX: IndexEntry[] = (() => {
  const out: IndexEntry[] = [];
  for (const [name, lat, lon, aliases] of CITY_TABLE) {
    const city: City = { name, lat, lon };
    const all = new Set<string>([normGeo(name), ...(aliases ?? []).map(normGeo)]);
    // «Frankfurt am Main» без «am Main» и т.п. — без скобок
    all.add(normGeo(name.replace(/\(.*?\)/g, '')));
    for (const a of all) if (a.length >= 3) out.push({ alias: a, city });
  }
  // длинные синонимы проверяем первыми: «frankfurt oder» раньше «frankfurt»
  return out.sort((a, b) => b.alias.length - a.alias.length);
})();

/** Находит город в произвольном тексте («60311 Frankfurt am Main», «Кёльн», «Koeln, NRW»). */
export function findCity(text?: string | null): City | null {
  if (!text) return null;
  const t = ` ${normGeo(text)} `;
  for (const { alias, city } of INDEX) {
    if (t.includes(` ${alias} `)) return city;
  }
  return null;
}

/** Расстояние по прямой между двумя точками, км (формула гаверсинуса). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const ANYWHERE_RE = /вся германия|deutschland|germany|bundesweit|по всей/i;

/** «Весь поиск без привязки к городу?» */
export function isAnywhere(city?: string | null): boolean {
  return !!city && ANYWHERE_RE.test(city);
}

/**
 * Радиус поиска в км из ответа анкеты. null — не задан; Infinity — без ограничения.
 * «В самом городе» трактуем как 15 км (город сам по себе бывает большим).
 */
export function parseRadiusKm(radius?: string | null): number | null {
  if (!radius) return null;
  if (/вся германия/i.test(radius)) return Infinity;
  if (/вся федеральная земля|регион/i.test(radius)) return 150;
  if (/в самом городе/i.test(radius)) return 15;
  const m = radius.match(/(\d{1,4})\s*(км|km)?/i);
  return m ? Math.max(5, +m[1]) : null;
}

export type LocationStatus = 'near' | 'far' | 'remote' | 'anywhere' | 'unknown';

export interface LocationFit {
  status: LocationStatus;
  distanceKm?: number;
  radiusKm?: number | null;
  /** Поправка к оценке: 0 или отрицательное число (до −32). */
  delta: number;
  /** Пояснение для человека; пусто, если нечего сказать. */
  note: string;
}

const REMOTE_RE = /remote|homeoffice|home office|deutschlandweit|bundesweit|mobiles arbeiten|удал[её]нн/i;
const DEFAULT_RADIUS_KM = 50;

/**
 * Насколько место вакансии далеко от города человека.
 * Источники расстояния по убыванию надёжности: готовое значение (напр. от Arbeitsagentur), координаты, город из текста.
 */
export function locationFit(
  profile: Pick<UserProfile, 'city' | 'radius' | 'relocation'>,
  vac: { text?: string | null; lat?: number; lon?: number; distanceKm?: number | null },
): LocationFit {
  const radiusKm = parseRadiusKm(profile.radius);
  const unknown: LocationFit = { status: 'unknown', radiusKm, delta: 0, note: '' };

  if (isAnywhere(profile.city) || radiusKm === Infinity) {
    return { status: 'anywhere', radiusKm, delta: 0, note: '' };
  }
  if (vac.text && REMOTE_RE.test(vac.text)) {
    return { status: 'remote', radiusKm, delta: 0, note: 'Можно работать удалённо или по всей стране.' };
  }

  const origin = findCity(profile.city);
  let d: number | null = typeof vac.distanceKm === 'number' ? Math.round(vac.distanceKm) : null;
  if (d == null && origin) {
    const target: GeoPoint | null =
      typeof vac.lat === 'number' && typeof vac.lon === 'number' ? { lat: vac.lat, lon: vac.lon } : findCity(vac.text);
    if (target) d = distanceKm(origin, target);
  }
  if (d == null) return unknown;

  const R = radiusKm ?? DEFAULT_RADIUS_KM;
  const from = origin?.name ?? profile.city ?? 'твоего города';
  if (d <= R) {
    return { status: 'near', distanceKm: d, radiusKm, delta: 0, note: `Недалеко: ~${d} км от ${from}.` };
  }

  const over = Math.min(2, d / R - 1);
  let delta = -Math.round(8 + 12 * over);
  const willing = /готов/i.test(profile.relocation || '') && !/не готов/i.test(profile.relocation || '');
  if (willing) delta = Math.round(delta / 2);
  return {
    status: 'far',
    distanceKm: d,
    radiusKm,
    delta: Math.max(-32, delta),
    note: `Далеко: ~${d} км от ${from}, а твой радиус — ${R} км.${willing ? ' Ты готов(а) переехать — уточни, помогает ли работодатель.' : ''}`,
  };
}
