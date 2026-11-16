// Проверка вакансий: рабочая ли ссылка, что написано на странице и подходит ли она именно этому человеку.
// Чистая логика без сети, БД и React: страницы приходят готовыми (см. inspectPage в web.ts), поэтому всё тестируется.
//
// Принципы:
//  1) Ничего не выдумываем. Сроки, контакты и требования берутся со страницы; нет данных → null.
//  2) «Мёртвой» считаем вакансию только по сильным признакам (404/410, истёкший срок в разметке,
//     явная фраза «Stelle besetzt»). Если сайт просто не пустил бота — это «не удалось проверить», а не «закрыта».
//  3) Жёсткие несоответствия (язык, срок подачи, аттестат) считаются правилами, а не мнением ИИ.
//  4) Без полного текста страницы уверенное «откликайся» не даём — только «возможно» и просьбу проверить.

import { stripDecorativeEmojis } from './emoji';
import type { LocationFit } from './geo';
import type {
  ApplyAdvice,
  Goal,
  LinkCheck,
  UserProfile,
  VacancyDetails,
  VacancyFit,
  VacancyIntel,
} from './types';

/* ------------------------------ Результат осмотра страницы ------------------------------ */

export interface PageInspection {
  /** Страница получена (2xx) и прочитана. */
  reachable: boolean;
  httpStatus?: number;
  finalUrl?: string;
  html?: string;
  text?: string;
  error?: 'timeout' | 'blocked-host' | 'network' | 'not-html' | 'redirects';
}

/* ------------------------------ Мелкие помощники ------------------------------ */

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = stripDecorativeEmojis(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function cleanList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = clean(x, maxLen);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function pushUnique(list: string[], item: string, max: number) {
  const t = item.trim();
  if (t && list.length < max && !list.some((o) => o.toLowerCase() === t.toLowerCase())) list.push(t);
}

/* ------------------------------ Немецкий и образование ------------------------------ */

const LEVEL_RANK: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
const RANK_LEVEL = ['—', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Уровень немецкого человека из профиля: 0 — не знает, 1–6 — A1–C2, null — не указан. */
export function germanRank(text?: string | null): number | null {
  if (!text) return null;
  if (/не знаю|нет немецк|пока не учил|без знания/i.test(text)) return 0;
  const m = text.toUpperCase().match(/\b([ABC][12])\b/g);
  if (!m) return null;
  return Math.max(...m.map((x) => LEVEL_RANK[x] ?? 0));
}

/** Требуемый уровень из текста вакансии: берём минимально достаточный («B1–B2» → B1). */
export function requiredGermanRank(text?: string | null): number | null {
  if (!text) return null;
  const m = text.toUpperCase().match(/\b([ABC][12])\b/g);
  if (m) return Math.min(...m.map((x) => LEVEL_RANK[x] ?? 9));
  if (/verhandlungssicher|muttersprach|flie(ß|ss)end|свободн|native/i.test(text)) return 5;
  if (/(sehr )?gute[rn]? deutsch|хорош/i.test(text)) return 4;
  if (/grundkenntnisse|elementar|базов/i.test(text)) return 2;
  return null;
}

export function levelName(rank: number): string {
  return RANK_LEVEL[rank] ?? '?';
}

/** Ранг школьного/профессионального образования: 1 Hauptschule … 4 Abitur, 5 вуз. */
export function educationRank(text?: string | null): number | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  if (/fachabitur|fachhochschulreife|fachoberschul|\bfos\b/.test(t)) return 3;
  if (/abitur|hochschulreife/.test(t)) return 4;
  if (/realschul|mittlere reife|mittlerer (schul|bildungs)abschluss|\bmsa\b|10\.? klasse/.test(t)) return 2;
  if (/hauptschul|erster (allgemeinbildender|schul)|\bberufsbildungsreife\b/.test(t)) return 1;
  if (/hochschulabschluss|hochschulstudium|abgeschlossenes studium|bachelor|master|universit/.test(t)) return 5;
  return null;
}

/** Образование человека (поле «Аттестат» в анкете Ausbildung). */
export function profileEducationRank(profile: UserProfile): number | null {
  const g = profile.graduation || '';
  if (!g) return null;
  if (/пока без аттестата/i.test(g)) return 0;
  if (/ещё учусь|другой страны/i.test(g)) return null;
  if (/вуз|бакалавр|магистр/i.test(g)) return 5;
  if (/профессиональн|колледж/i.test(g)) return 3;
  return educationRank(g);
}

/* ------------------------------ Даты ------------------------------ */

/** Разбор даты из ISO или формата 31.12.2026 / 31.12.26. null — если не дата. */
export function parseDateLoose(text?: string | null): Date | null {
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 23, 59, 59));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const de = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (de) {
    const y = +de[3] < 100 ? 2000 + +de[3] : +de[3];
    const d = new Date(Date.UTC(y, +de[2] - 1, +de[1], 23, 59, 59));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/* ------------------------------ Разметка JobPosting (schema.org) ------------------------------ */

export interface LdPosting {
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  deadline?: string; // validThrough
  postedAt?: string; // datePosted
  startDate?: string;
  employmentType?: string;
}

const EMPLOYMENT_RU: Record<string, string> = {
  FULL_TIME: 'Vollzeit',
  PART_TIME: 'Teilzeit',
  CONTRACTOR: 'Freelance',
  TEMPORARY: 'befristet / Zeitarbeit',
  INTERN: 'Praktikum',
  VOLUNTEER: 'ehrenamtlich',
  PER_DIEM: 'почасовая',
  OTHER: '',
};

const UNIT_RU: Record<string, string> = { HOUR: 'в час', DAY: 'в день', WEEK: 'в неделю', MONTH: 'в месяц', YEAR: 'в год' };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function findJobPosting(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  const t = o['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.some((x) => typeof x === 'string' && x.toLowerCase() === 'jobposting')) return o;
  if (o['@graph']) return findJobPosting(o['@graph'], depth + 1);
  return null;
}

function ldLocation(v: unknown): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  if (!first || typeof first !== 'object') return str(first);
  const a = (first as Record<string, unknown>).address;
  if (a && typeof a === 'object') {
    const ad = a as Record<string, unknown>;
    const parts = [str(ad.postalCode), str(ad.addressLocality), str(ad.addressRegion)].filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  }
  return str(a);
}

function ldSalary(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const cur = str(o.currency) || '';
  const val = o.value;
  if (val && typeof val === 'object') {
    const vo = val as Record<string, unknown>;
    const min = vo.minValue,
      max = vo.maxValue,
      one = vo.value;
    const unit = typeof vo.unitText === 'string' ? UNIT_RU[vo.unitText.toUpperCase()] || '' : '';
    const range =
      min != null && max != null && min !== max ? `${min}–${max}` : one != null ? `${one}` : min != null ? `${min}` : max != null ? `${max}` : '';
    if (range) return [range, cur, unit].filter(Boolean).join(' ');
  }
  if (typeof val === 'number' || typeof val === 'string') return [String(val), cur].filter(Boolean).join(' ');
  return undefined;
}

/** Достаёт данные вакансии из JSON-LD (schema.org/JobPosting) — самый надёжный источник, если он есть. */
export function parseJobPostingLd(html: string): LdPosting | null {
  if (!html) return null;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let json: unknown;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const jp = findJobPosting(json);
    if (!jp) continue;
    const org = jp.hiringOrganization;
    const emp = jp.employmentType;
    const empText = (Array.isArray(emp) ? emp : [emp])
      .map((e) => (typeof e === 'string' ? EMPLOYMENT_RU[e.toUpperCase()] ?? e : ''))
      .filter(Boolean)
      .join(', ');
    return {
      title: str(jp.title),
      company: typeof org === 'string' ? str(org) : org && typeof org === 'object' ? str((org as Record<string, unknown>).name) : undefined,
      location: ldLocation(jp.jobLocation),
      salary: ldSalary(jp.baseSalary),
      deadline: str(jp.validThrough),
      postedAt: str(jp.datePosted),
      startDate: str(jp.jobStartDate),
      employmentType: empText || undefined,
    };
  }
  return null;
}

/* ------------------------------ Признаки «вакансия закрыта» ------------------------------ */

const CLOSED_PATTERNS: RegExp[] = [
  /diese (stelle|position|anzeige|stellenanzeige|ausbildungsstelle)[^.]{0,30}(wurde|ist)[^.]{0,20}(besetzt|nicht mehr (verfügbar|aktuell|online)|abgelaufen|deaktiviert|geschlossen)/i,
  /(stelle|stellenanzeige|anzeige|position|ausbildungsplatz)[^.]{0,40}(nicht mehr (verfügbar|aktuell|online)|ist (bereits )?besetzt|wurde besetzt|abgelaufen|ist offline)/i,
  /bewerbungsfrist (ist )?(bereits )?(abgelaufen|vorbei|beendet)/i,
  /(job|position|vacancy|posting|listing|ad)[^.]{0,30}(no longer (available|active|open|accepting)|has (already )?(been )?(filled|closed|expired)|is (now )?(closed|expired|filled))/i,
  /seite (nicht gefunden|existiert nicht)|page not found|error 404|404 (not found|error)/i,
  /вакансия (закрыта|неактуальна|снята)|объявление (неактуально|снято)/i,
];

/** Возвращает найденную фразу или null. Ищем в начале страницы: футеры и баннеры не должны давать ложных срабатываний. */
export function detectClosedSignal(text: string): string | null {
  const head = (text || '').slice(0, 4000);
  for (const re of CLOSED_PATTERNS) {
    const m = head.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').slice(0, 80);
  }
  return null;
}

/* ------------------------------ Проверка ссылки ------------------------------ */

function pathOf(u?: string): string | null {
  if (!u) return null;
  try {
    return new URL(u).pathname;
  } catch {
    return null;
  }
}

export function assessLink(
  url: string,
  ins: PageInspection,
  now: Date = new Date(),
): { link: LinkCheck; ld: LdPosting | null } {
  const checkedAt = now.toISOString();
  const base = { httpStatus: ins.httpStatus, finalUrl: ins.finalUrl && ins.finalUrl !== url ? ins.finalUrl : undefined, checkedAt };
  const make = (state: LinkCheck['state'], note: string, pageRead: boolean, ld: LdPosting | null = null) => ({
    link: { state, note, pageRead, ...base } as LinkCheck,
    ld,
  });

  if (!ins.reachable) {
    const st = ins.httpStatus;
    if (st === 404 || st === 410) return make('closed', `Страница не найдена (${st}) — вакансия, скорее всего, снята.`, false);
    if (st === 401 || st === 403 || st === 429) return make('unverified', `Сайт не пустил автоматическую проверку (${st}) — открой ссылку сам.`, false);
    if (st && st >= 500) return make('unverified', `Сайт сейчас отвечает ошибкой ${st} — проверь позже.`, false);
    if (st) return make('unverified', `Сайт ответил кодом ${st} — проверь ссылку вручную.`, false);
    const why =
      ins.error === 'timeout'
        ? 'сайт не ответил вовремя'
        : ins.error === 'blocked-host'
          ? 'адрес нельзя безопасно открыть'
          : ins.error === 'not-html'
            ? 'это не веб-страница (например, файл)'
            : ins.error === 'redirects'
              ? 'слишком много перенаправлений'
              : 'не удалось соединиться';
    return make('unverified', `Не удалось проверить: ${why}. Открой ссылку сам.`, false);
  }

  const ld = parseJobPostingLd(ins.html || '');
  if (ld?.deadline) {
    const d = parseDateLoose(ld.deadline);
    if (d && d.getTime() < now.getTime()) {
      return make('closed', `Срок подачи истёк (${ld.deadline.slice(0, 10)}).`, true, ld);
    }
  }
  const text = ins.text || '';
  const signal = detectClosedSignal(text);
  if (signal) return make('closed', `На странице написано, что вакансия закрыта: «${signal}».`, true, ld);

  const origPath = pathOf(url);
  const finalPath = pathOf(ins.finalUrl);
  if (finalPath === '/' && origPath && origPath.length > 1) {
    return make('unverified', 'Ссылка ведёт на главную страницу сайта — вакансия, возможно, снята. Проверь вручную.', false, ld);
  }
  if (text.length < 250 && !ld) {
    return make('unverified', 'Страница открылась, но текста почти нет (нужен вход или JavaScript). Проверь вручную.', false);
  }
  const extra = ld?.deadline ? `, срок подачи: ${ld.deadline.slice(0, 10)}` : '';
  return make('ok', `Страница открылась, вакансия активна${extra}.`, text.length >= 250 || !!ld, ld);
}

/* ------------------------------ Текст страницы для ИИ ------------------------------ */

const KEY_SENTENCE =
  /(bewerb|frist|bis (zum|spätestens)|kontakt|ansprechpartner|e-?mail|@|telefon|beginn|ab sofort|start|vergütung|gehalt|lohn|deutsch|abschluss|voraussetz|anforder|profil|wir erwarten|dein|ihr(e)? (profil|aufgaben)|aufgaben|ausbildungsdauer|jahre|führerschein|zeugnis|unterlagen|подач|срок|требован|контакт)/i;

/** Начало страницы + предложения с ключевыми словами из остального текста (срок, контакты, требования обычно ниже). */
export function focusText(text: string, maxChars = 3200): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const headLen = Math.floor(maxChars * 0.6);
  const head = t.slice(0, headLen);
  const rest = t.slice(headLen).split(/(?<=[.!?:;])\s+/);
  const picked: string[] = [];
  let used = head.length;
  for (const s of rest) {
    if (!KEY_SENTENCE.test(s)) continue;
    const piece = s.slice(0, 220);
    if (used + piece.length + 1 > maxChars) break;
    picked.push(piece);
    used += piece.length + 1;
  }
  return picked.length ? `${head} … ${picked.join(' ')}` : head;
}

/* ------------------------------ Подробности вакансии ------------------------------ */

function normForCompare(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s()/-]{6,}\d/g;

/** Контакт принимаем, только если его e-mail/телефон реально есть в тексте страницы (против выдуманных). */
export function groundContact(contact: string | null | undefined, pageText: string): string | null {
  const c = clean(contact, 200);
  if (!c || !pageText) return null;
  const emails = c.match(EMAIL_RE) ?? [];
  const phones = (c.match(PHONE_RE) ?? []).map((p) => p.replace(/[^\d]/g, ''));
  const hayDigits = pageText.replace(/[^\d]/g, '');
  const hay = normForCompare(pageText);
  if (emails.length || phones.length) {
    const okMail = emails.every((e) => hay.includes(e.toLowerCase()));
    const okPhone = phones.every((p) => p.length >= 6 && hayDigits.includes(p));
    return okMail && okPhone ? c : null;
  }
  return hay.includes(normForCompare(c)) ? c : null;
}

/** Приводит ответ ИИ к безопасному виду; данные из JSON-LD имеют приоритет над ответом ИИ. */
export function normalizeDetails(
  raw: unknown,
  opts: { source: 'page' | 'snippet'; ld?: LdPosting | null; pageText?: string },
): VacancyDetails {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ld = opts.ld ?? null;
  const pick = (a: string | undefined | null, b: unknown, max = 160) => clean(a ?? undefined, max) ?? clean(b, max);
  return {
    source: opts.source,
    deadline: pick(ld?.deadline?.slice(0, 10), r.deadline, 80),
    startDate: pick(ld?.startDate, r.startDate, 80),
    postedAt: pick(ld?.postedAt?.slice(0, 10), r.postedAt, 40),
    employmentType: pick(ld?.employmentType, r.employmentType, 80),
    duration: clean(r.duration, 60),
    salary: pick(ld?.salary, r.salary, 120),
    germanRequired: clean(r.germanRequired, 80),
    education: clean(r.education, 120),
    requirements: cleanList(r.requirements, 6, 160),
    tasks: cleanList(r.tasks, 5, 140),
    benefits: cleanList(r.benefits, 5, 120),
    howToApply: clean(r.howToApply, 220),
    contact: opts.pageText ? groundContact(r.contact as string | undefined, opts.pageText) : null,
  };
}

/** Данные, которые удалось взять без ИИ (только разметка страницы). */
export function detailsFromLd(ld: LdPosting | null, source: 'page' | 'snippet'): VacancyDetails {
  return normalizeDetails({}, { source, ld });
}

export function hasAnyDetails(d?: VacancyDetails | null): boolean {
  if (!d) return false;
  return !!(
    d.deadline || d.startDate || d.postedAt || d.employmentType || d.duration || d.salary || d.germanRequired ||
    d.education || d.howToApply || d.contact || d.requirements.length || d.tasks.length || d.benefits.length
  );
}

/* ------------------------------ Рекомендация «подходит ли мне» ------------------------------ */

export interface LlmFit {
  advice?: unknown;
  summary?: unknown;
  matches?: unknown;
  gaps?: unknown;
  blockers?: unknown;
  actions?: unknown;
}

const ADVICE_ORDER: Record<ApplyAdvice, number> = { skip: 0, maybe: 1, apply: 2 };
const ADVICE_LABEL: Record<ApplyAdvice, string> = {
  apply: 'Откликайся',
  maybe: 'Откликайся, но учти пробелы',
  skip: 'Лучше пропустить',
};

function parseAdvice(v: unknown): ApplyAdvice | null {
  return v === 'apply' || v === 'maybe' || v === 'skip' ? v : null;
}

function worst(a: ApplyAdvice, b: ApplyAdvice): ApplyAdvice {
  return ADVICE_ORDER[a] <= ADVICE_ORDER[b] ? a : b;
}

/**
 * Итоговая рекомендация = жёсткие правила + мнение ИИ. ИИ может только понизить рекомендацию,
 * поднять её выше, чем позволяют правила и оценка, он не может. Заодно возвращаем потолок для оценки,
 * чтобы сортировка списка не противоречила рекомендации.
 */
export function computeFit(args: {
  profile: UserProfile;
  goal: Goal;
  link: LinkCheck;
  details?: VacancyDetails | null;
  llm?: LlmFit | null;
  score?: number | null;
  /** true — ИИ читал полный текст страницы этой вакансии (иначе рекомендация предварительная). */
  pageAnalyzed?: boolean;
  /** Расстояние до места вакансии (из geo.locationFit): близко — плюс, далеко — пробел. */
  location?: LocationFit | null;
  now?: Date;
}): { fit: VacancyFit; scoreCap: number | null } {
  const { profile, goal, link, details, llm } = args;
  const now = args.now ?? new Date();
  const score = typeof args.score === 'number' ? args.score : null;
  const basedOnPage = !!args.pageAnalyzed && link.pageRead;

  const matches: string[] = [];
  const gaps: string[] = [];
  const blockers: string[] = [];
  const actions: string[] = [];
  const detBlockers: string[] = [];

  // --- ссылка и срок ---
  if (link.state === 'closed') {
    detBlockers.push(link.note);
  }
  const deadline = parseDateLoose(details?.deadline);
  if (deadline) {
    const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
    if (days < 0 && link.state !== 'closed') detBlockers.push(`Срок подачи уже прошёл (${details?.deadline}).`);
    else if (days >= 0 && days <= 14) actions.push(`Срок подачи скоро (${details?.deadline}) — не откладывай отклик.`);
  }

  // --- немецкий ---
  const req = requiredGermanRank(details?.germanRequired);
  if (req != null) {
    const have = germanRank(profile.germanLevel);
    if (have == null) {
      gaps.push(`Требуется немецкий ${levelName(req)}, а твой уровень в профиле не указан.`);
    } else if (have < req) {
      const msg = `Требуется немецкий ${levelName(req)}, у тебя ${have === 0 ? 'нет немецкого' : levelName(have)}.`;
      if (req - have >= 2) detBlockers.push(`${msg} Разрыв слишком большой для отклика сейчас.`);
      else gaps.push(`${msg} Подтяни уровень или честно напиши в письме, что учишь язык.`);
    } else {
      matches.push(`Немецкий подходит: нужен ${levelName(req)}, у тебя ${levelName(have)}.`);
    }
  }

  // --- образование (аттестат) для Ausbildung ---
  if (goal === 'ausbildung') {
    const needEdu = educationRank(details?.education);
    if (needEdu != null) {
      const haveEdu = profileEducationRank(profile);
      if (haveEdu == null) {
        if (/другой страны/i.test(profile.graduation || '')) {
          actions.push('Проверь, признают ли твой аттестат для этого места (anabin / Zeugnisbewertung).');
        } else {
          gaps.push('Для места указан минимальный аттестат, а твой в профиле не указан.');
        }
      } else if (haveEdu < needEdu) {
        const msg = `Требуется образование «${details?.education}», твой аттестат ниже.`;
        if (needEdu - haveEdu >= 2) detBlockers.push(msg);
        else gaps.push(msg);
      } else {
        matches.push('Аттестат соответствует требованию.');
      }
    }
  }

  // --- статус, признание, договор ---
  if (/нужна виза|не разобрал/i.test(profile.workPermit || '')) {
    actions.push('Уточни у работодателя, готов ли он принять кандидата с твоим статусом или оформить визу.');
  }
  if (goal === 'job' && /не подавал|подал|жду/i.test(profile.recognition || '')) {
    actions.push('Для работы по специальности может понадобиться признание диплома (Anerkennung) — начни процесс заранее.');
  }
  if (
    /только бессрочный/i.test(profile.contract || '') &&
    /befristet|zeitarbeit|leiharbeit|срочн|временн/i.test(details?.employmentType || '') &&
    !/unbefristet/i.test(details?.employmentType || '')
  ) {
    gaps.push('Договор не бессрочный, а ты ищешь бессрочный.');
  }

  // --- расстояние ---
  if (args.location?.note) {
    if (args.location.status === 'near') pushUnique(matches, args.location.note, 5);
    else if (args.location.status === 'far') pushUnique(gaps, args.location.note, 5);
  }

  // --- мнение ИИ (только дополняет) ---
  const llmMatches = cleanList(llm?.matches, 4, 170);
  const llmGaps = cleanList(llm?.gaps, 4, 170);
  const llmBlockers = cleanList(llm?.blockers, 2, 170);
  const llmActions = cleanList(llm?.actions, 4, 170);
  for (const x of llmMatches) pushUnique(matches, x, 5);
  for (const x of llmGaps) pushUnique(gaps, x, 5);
  for (const x of llmBlockers) pushUnique(blockers, x, 3);
  for (const x of llmActions) pushUnique(actions, x, 5);
  for (const x of detBlockers) {
    if (!blockers.includes(x)) blockers.unshift(x);
  }

  // --- итоговая рекомендация ---
  const scoreAdvice: ApplyAdvice = score == null ? 'maybe' : score >= 70 ? 'apply' : score >= 50 ? 'maybe' : 'skip';
  let advice: ApplyAdvice = detBlockers.length ? 'skip' : worst(parseAdvice(llm?.advice) ?? scoreAdvice, scoreAdvice);
  if (advice === 'apply' && (gaps.length >= 3 || blockers.length > 0)) advice = 'maybe';
  if (advice === 'apply' && !basedOnPage) advice = 'maybe'; // без текста страницы уверенно не рекомендуем

  let summary = clean(llm?.summary, 300);
  if (!summary) {
    summary =
      advice === 'apply'
        ? 'Вакансия совпадает с твоим профилем по ключевым пунктам.'
        : advice === 'maybe'
          ? 'Подходит частично: есть пробелы, которые стоит учесть до отклика.'
          : detBlockers.length
            ? 'Есть жёсткое несоответствие, из-за которого отклик сейчас вряд ли сработает.'
            : 'Совпадение с профилем слабое.';
  }
  if (!basedOnPage) summary += ' Оценка по краткому описанию из поиска — открой вакансию и сверь требования.';

  let scoreCap: number | null = null;
  if (detBlockers.length) scoreCap = 35;
  else if (advice === 'skip') scoreCap = 49;
  else if (advice === 'maybe') scoreCap = 79;

  return {
    fit: {
      advice,
      label: ADVICE_LABEL[advice],
      summary,
      matches: matches.slice(0, 5),
      gaps: gaps.slice(0, 5),
      blockers: blockers.slice(0, 3),
      actions: actions.slice(0, 5),
      basedOnPage,
    },
    scoreCap,
  };
}

/* ------------------------------ Хранение и чтение ------------------------------ */

function asArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => stripDecorativeEmojis(x)) : [];
}

/** Читает JSON из БД: у старых вакансий поля нет, битый JSON не должен ломать страницу. */
export function parseIntel(raw: string | null | undefined): VacancyIntel | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !o.link || typeof o.link.state !== 'string') return null;
    const link: LinkCheck = {
      state: o.link.state === 'ok' || o.link.state === 'closed' ? o.link.state : 'unverified',
      note: clean(o.link.note, 300) ?? '',
      httpStatus: typeof o.link.httpStatus === 'number' ? o.link.httpStatus : undefined,
      finalUrl: typeof o.link.finalUrl === 'string' ? o.link.finalUrl : undefined,
      pageRead: !!o.link.pageRead,
      checkedAt: typeof o.link.checkedAt === 'string' ? o.link.checkedAt : '',
    };
    const d = o.details;
    const details = d
      ? ({
          source: d.source === 'page' ? 'page' : 'snippet',
          deadline: clean(d.deadline, 80),
          startDate: clean(d.startDate, 80),
          postedAt: clean(d.postedAt, 40),
          employmentType: clean(d.employmentType, 80),
          duration: clean(d.duration, 60),
          salary: clean(d.salary, 120),
          germanRequired: clean(d.germanRequired, 80),
          education: clean(d.education, 120),
          requirements: asArr(d.requirements),
          tasks: asArr(d.tasks),
          benefits: asArr(d.benefits),
          howToApply: clean(d.howToApply, 220),
          contact: clean(d.contact, 200),
        } as VacancyDetails)
      : undefined;
    const f = o.fit;
    const advice = parseAdvice(f?.advice);
    const fit = f && advice
      ? ({
          advice,
          label: ADVICE_LABEL[advice],
          summary: clean(f.summary, 400) ?? '',
          matches: asArr(f.matches),
          gaps: asArr(f.gaps),
          blockers: asArr(f.blockers),
          actions: asArr(f.actions),
          basedOnPage: !!f.basedOnPage,
        } as VacancyFit)
      : undefined;
    return { link, details, fit };
  } catch {
    return null;
  }
}

/** Краткий текст для агента в чате: что известно о ссылке, сроках и рекомендации. */
export function intelToText(intel?: VacancyIntel | null): string[] {
  if (!intel) return [];
  const lines: string[] = [];
  const st = intel.link.state === 'ok' ? 'проверена, открывается' : intel.link.state === 'closed' ? 'вакансия неактуальна' : 'не удалось проверить';
  lines.push(`Ссылка: ${st}${intel.link.note ? ` (${intel.link.note})` : ''}`);
  const d = intel.details;
  if (d) {
    const rows: [string, string | null | undefined][] = [
      ['Срок подачи', d.deadline],
      ['Начало', d.startDate],
      ['Опубликовано', d.postedAt],
      ['Тип занятости', d.employmentType],
      ['Длительность обучения', d.duration],
      ['Доход / Vergütung', d.salary],
      ['Нужный немецкий', d.germanRequired],
      ['Образование', d.education],
      ['Как подать заявку', d.howToApply],
      ['Контакт', d.contact],
    ];
    for (const [k, v] of rows) if (v) lines.push(`${k}: ${v}`);
    if (d.requirements.length) lines.push(`Требования: ${d.requirements.join('; ')}`);
    if (d.tasks.length) lines.push(`Задачи: ${d.tasks.join('; ')}`);
    if (d.benefits.length) lines.push(`Условия: ${d.benefits.join('; ')}`);
    lines.push(`Данные взяты: ${d.source === 'page' ? 'со страницы вакансии' : 'только из краткой выдачи поиска'}`);
  }
  const f = intel.fit;
  if (f) {
    lines.push(`Рекомендация для этого человека: ${f.label}. ${f.summary}`);
    if (f.blockers.length) lines.push(`Жёсткие несоответствия: ${f.blockers.join('; ')}`);
    if (f.gaps.length) lines.push(`Пробелы: ${f.gaps.join('; ')}`);
    if (f.matches.length) lines.push(`Совпадения: ${f.matches.join('; ')}`);
    if (f.actions.length) lines.push(`Что сделать перед откликом: ${f.actions.join('; ')}`);
  }
  return lines;
}
