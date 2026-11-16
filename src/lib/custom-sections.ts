// Свои разделы и поля профиля: чистая логика без БД и React.
// Используется формой (шаблоны, лимиты), сохранением профиля (нормализация),
// текстом для ИИ и памятью агента.

import type { CustomSection } from './types';

export const CUSTOM_LIMITS = {
  sections: 8,
  fieldsPerSection: 20,
  title: 60,
  label: 80,
  value: 1500,
} as const;

/** Быстрые шаблоны разделов: заготовка заголовка и названий полей. */
export const CUSTOM_SECTION_TEMPLATES: { title: string; labels: string[] }[] = [
  { title: 'Проекты и работы', labels: ['Название', 'Ссылка', 'Что делал(а) и чего достиг(ла)'] },
  { title: 'Ссылки', labels: ['LinkedIn', 'GitHub / портфолио', 'Сайт'] },
  { title: 'Волонтёрство и хобби', labels: ['Чем занимаешься', 'Как давно'] },
  { title: 'Особые условия', labels: ['Ограничения по здоровью', 'График и семья', 'Чего избегать'] },
];

export function newCustomId(prefix: 'sec' | 'fld'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/**
 * Приводит произвольный JSON к безопасному виду: типы, лимиты длины и количества, уникальные id.
 * dropEmpty=false сохраняет пустые поля (идёт набор текста в форме), true — выкидывает пустое
 * (для отправки агенту и памяти).
 */
export function normalizeCustomSections(
  input: unknown,
  opts: { dropEmpty?: boolean } = {},
): CustomSection[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const usedSec = new Set<string>();
  const out: CustomSection[] = [];

  for (const rawSec of input.slice(0, CUSTOM_LIMITS.sections)) {
    if (!rawSec || typeof rawSec !== 'object') continue;
    const sec = rawSec as Record<string, unknown>;
    const title = clip(sec.title, CUSTOM_LIMITS.title);
    let id = clip(sec.id, 40) || newCustomId('sec');
    while (usedSec.has(id)) id = newCustomId('sec');
    usedSec.add(id);

    const usedFld = new Set<string>();
    const fields: CustomSection['fields'] = [];
    const rawFields = Array.isArray(sec.fields) ? sec.fields : [];
    for (const rawFld of rawFields.slice(0, CUSTOM_LIMITS.fieldsPerSection)) {
      if (!rawFld || typeof rawFld !== 'object') continue;
      const f = rawFld as Record<string, unknown>;
      const label = clip(f.label, CUSTOM_LIMITS.label);
      const value = clip(f.value, CUSTOM_LIMITS.value);
      if (opts.dropEmpty && !value.trim()) continue;
      let fid = clip(f.id, 40) || newCustomId('fld');
      while (usedFld.has(fid)) fid = newCustomId('fld');
      usedFld.add(fid);
      fields.push({
        id: fid,
        label: opts.dropEmpty ? label.trim() : label,
        value: opts.dropEmpty ? value.trim() : value,
      });
    }

    if (opts.dropEmpty && !fields.length) continue;
    out.push({ id, title: opts.dropEmpty ? title.trim() : title, fields });
  }
  return out.length ? out : opts.dropEmpty ? undefined : [];
}

/** Строки для текста профиля и памяти: «Раздел — Поле: значение». Пустые значения пропускаются. */
export function customFieldLines(sections: CustomSection[] | undefined): string[] {
  const lines: string[] = [];
  for (const sec of sections ?? []) {
    const title = sec.title.trim() || 'Свой раздел';
    for (const f of sec.fields) {
      const value = f.value.trim();
      if (!value) continue;
      const label = f.label.trim();
      lines.push(`${title}${label ? ` — ${label}` : ''}: ${value}`);
    }
  }
  return lines;
}

/** Сколько заполненных своих полей (для счётчиков в интерфейсе). */
export function customFilledCount(sections: CustomSection[] | undefined): number {
  return customFieldLines(sections).length;
}
