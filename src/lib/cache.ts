// Небольшой дисковый кеш (JSON-файлы). Нужен, чтобы повторный поиск не ходил заново в сеть и к ИИ:
// быстрее, дешевле и — главное — стабильнее (одни и те же входные данные дают тот же результат).
// Кеш необязателен: любая ошибка чтения/записи молча игнорируется, поиск работает и без него.
// Расположение: db/cache (CACHE_DIR в .env переопределяет). Содержимое можно удалять в любой момент.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const HOUR_MS = 3_600_000;

function root(): string {
  return process.env.CACHE_DIR?.trim() || path.join(process.cwd(), 'db', 'cache');
}

function safe(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || '_';
}

/** Ключ из любых значений: одинаковые данные → одинаковый ключ. */
export function cacheKey(...parts: unknown[]): string {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

function fileFor(ns: string, key: string): string {
  return path.join(/*turbopackIgnore: true*/ root(), safe(ns), `${safe(key)}.json`);
}

interface Entry<T> {
  at: number;
  v: T;
}

export async function cacheGet<T>(ns: string, key: string, ttlMs: number): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(fileFor(ns, key), 'utf8');
    const e = JSON.parse(raw) as Entry<T>;
    if (!e || typeof e.at !== 'number' || Date.now() - e.at > ttlMs) return undefined;
    return e.v;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(ns: string, key: string, value: T): Promise<void> {
  try {
    const file = fileFor(ns, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ at: Date.now(), v: value } satisfies Entry<T>), 'utf8');
    await fs.rename(tmp, file); // атомарная замена: параллельный поиск не увидит половину файла
  } catch {
    // кеш — удобство, а не требование
  }
}

/**
 * Достаёт из кеша или считает и кладёт. shouldStore=false не даёт закешировать неудачный результат
 * (пустой ответ поиска, ошибку ИИ) — иначе сбой закрепился бы на весь срок хранения.
 */
export async function cached<T>(
  ns: string,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  shouldStore: (v: T) => boolean = () => true,
): Promise<{ value: T; hit: boolean }> {
  const hit = await cacheGet<T>(ns, key, ttlMs);
  if (hit !== undefined) return { value: hit, hit: true };
  const value = await fn();
  if (shouldStore(value)) await cacheSet(ns, key, value);
  return { value, hit: false };
}

/** Удаляет старые записи (по умолчанию старше 7 дней) и ограничивает общее число файлов. */
export async function pruneCache(maxAgeMs = 7 * 24 * HOUR_MS, maxFiles = 3000): Promise<number> {
  let removed = 0;
  try {
    const base = root();
    const files: { file: string; mtime: number }[] = [];
    for (const ns of await fs.readdir(base)) {
      const dir = path.join(/*turbopackIgnore: true*/ base, ns);
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        const file = path.join(/*turbopackIgnore: true*/ dir, n);
        try {
          files.push({ file, mtime: (await fs.stat(file)).mtimeMs });
        } catch {
          // файл исчез между чтением каталога и stat
        }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const now = Date.now();
    for (let i = 0; i < files.length; i++) {
      if (i >= maxFiles || now - files[i].mtime > maxAgeMs) {
        await fs.rm(files[i].file, { force: true });
        removed++;
      }
    }
  } catch {
    // каталога кеша ещё нет — чистить нечего
  }
  return removed;
}
