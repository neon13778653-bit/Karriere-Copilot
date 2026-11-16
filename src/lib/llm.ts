// Серверная абстракция над LLM.
//  1) custom (ollama / lmstudio / groq / openrouter / custom) — OpenAI-совместимый сервер, выбранный в настройках.
//  2) «встроенный» ИИ — то, что настроено на этом компьютере:
//       a) z-ai-web-dev-sdk, если найден файл .z-ai-config (рабочая среда разработки);
//       b) любой OpenAI-совместимый сервер из .env: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL.
//     Если не настроено ни то ни другое — встроенного ИИ нет, и приложение честно об этом говорит.
// При сбое custom-сервера до первого токена — откат на встроенный. Если ответ уже пошёл и оборвался,
// второй ответ НЕ дописывается (иначе пользователь увидит обрезок + дубль).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ZAI from 'z-ai-web-dev-sdk';
import type { BackendConfig } from './types';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCallResult {
  text: string;
  used: 'builtin' | 'custom';
  fallbackReason?: string;
}

// ---------- Таймауты (локальные модели бывают медленными) ----------
function envMs(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}
/** Нестриминговый вызов целиком (глубокий анализ на слабом железе может идти долго). */
const COMPLETE_TIMEOUT_MS = envMs('LLM_TIMEOUT_MS', 240_000);
/** Ожидание ответа сервера и первого токена (загрузка модели в память у Ollama бывает долгой). */
const FIRST_TOKEN_TIMEOUT_MS = envMs('LLM_FIRST_TOKEN_TIMEOUT_MS', 90_000);
/** Максимальная пауза между порциями уже идущего потока. */
const STREAM_IDLE_TIMEOUT_MS = envMs('LLM_STREAM_IDLE_TIMEOUT_MS', 45_000);

const NO_AI_MESSAGE =
  'Встроенный ИИ не настроен на этом компьютере. Открой «ИИ-сервер» и выбери Ollama, LM Studio или облако (Groq, OpenRouter), либо задай LLM_BASE_URL и LLM_API_KEY в файле .env.';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'неизвестная ошибка';
}

// ---------- Что настроено на этом компьютере ----------
export type BuiltinMode = 'zai' | 'env' | 'none';

let zaiConfigCache: boolean | null = null;

/** Повторяет поиск конфигурации из z-ai-web-dev-sdk: без файла ZAI.create() всегда бросает ошибку. */
export function zaiConfigured(): boolean {
  if (zaiConfigCache === true) return true;
  const candidates = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ];
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'));
      if (cfg?.baseUrl && cfg?.apiKey) {
        zaiConfigCache = true;
        return true;
      }
    } catch {
      // файла нет или он невалиден — пробуем следующий
    }
  }
  return false;
}

/** OpenAI-совместимый сервер из .env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). */
export function envBackend(): BackendConfig | null {
  const url = (process.env.LLM_BASE_URL || '').trim();
  if (!/^https?:\/\//.test(url)) return null;
  return {
    provider: 'custom',
    customUrl: url,
    customKey: (process.env.LLM_API_KEY || '').trim() || undefined,
    customModel: (process.env.LLM_MODEL || '').trim() || undefined,
  };
}

export function builtinMode(): BuiltinMode {
  if (zaiConfigured()) return 'zai';
  if (envBackend()) return 'env';
  return 'none';
}

// ---------- z-ai-web-dev-sdk ----------
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
let zaiCreating: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

export async function getZai() {
  if (zaiInstance) return zaiInstance;
  if (!zaiCreating) {
    zaiCreating = ZAI.create().catch((e) => {
      zaiCreating = null;
      throw e;
    });
  }
  zaiInstance = await zaiCreating;
  return zaiInstance;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export function isCustomBackend(cfg?: BackendConfig | null): boolean {
  return (
    !!cfg &&
    cfg.provider !== 'builtin' &&
    !!cfg.customUrl &&
    cfg.customUrl.startsWith('http')
  );
}

function customEndpoint(cfg: BackendConfig): string {
  const url = (cfg.customUrl || '').trim().replace(/\/+$/, '');
  return `${url}/chat/completions`;
}

function customHeaders(cfg: BackendConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = (cfg.customKey || '').trim();
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

// ---------- OpenAI-совместимый клиент ----------
async function openaiComplete(
  cfg: BackendConfig,
  messages: LlmMessage[],
  temperature: number,
  maxTokens?: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.customModel || 'default',
    messages,
    stream: false,
    temperature,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  let res: Response;
  try {
    res = await fetch(customEndpoint(cfg), {
      method: 'POST',
      headers: customHeaders(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`таймаут ${Math.round(COMPLETE_TIMEOUT_MS / 1000)} с`);
    }
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('пустой ответ');
  return text;
}

/**
 * Читает SSE-поток в формате OpenAI и отдаёт текстовые дельты.
 * onActivity вызывается при каждой порции байт (сброс таймера бездействия).
 */
async function* readSse(
  stream: ReadableStream<Uint8Array>,
  onActivity?: () => void,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta: string = json?.choices?.[0]?.delta?.content || '';
          if (delta) yield delta;
        } catch {
          // игнорируем битые строки SSE
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/**
 * Стрим с OpenAI-совместимого сервера.
 * Таймаут — НЕ на весь ответ, а на ожидание первого токена и на паузы внутри потока:
 * длинный ответ локальной модели (минуты) не должен обрываться.
 */
async function* openaiStream(
  cfg: BackendConfig,
  messages: LlmMessage[],
  temperature: number,
): AsyncGenerator<string> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutReason = '';
  const arm = (ms: number, reason: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timeoutReason = reason;
      ctrl.abort();
    }, ms);
  };

  arm(FIRST_TOKEN_TIMEOUT_MS, `нет ответа за ${Math.round(FIRST_TOKEN_TIMEOUT_MS / 1000)} с`);
  try {
    const res = await fetch(customEndpoint(cfg), {
      method: 'POST',
      headers: customHeaders(cfg),
      body: JSON.stringify({
        model: cfg.customModel || 'default',
        messages,
        stream: true,
        temperature,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    // таймер первого токена продолжает идти; после первой порции байт переходим на «паузу в потоке»
    const gen = readSse(res.body, () =>
      arm(STREAM_IDLE_TIMEOUT_MS, `поток замолчал на ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} с`),
    );
    for await (const delta of gen) yield delta;
  } catch (e) {
    if (timeoutReason) throw new Error(timeoutReason);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- Встроенный ИИ ----------
async function builtinComplete(
  messages: LlmMessage[],
  temperature: number,
  maxTokens?: number,
): Promise<LlmCallResult> {
  const mode = builtinMode();
  if (mode === 'none') throw new Error(NO_AI_MESSAGE);

  if (mode === 'env') {
    const text = await openaiComplete(envBackend()!, messages, temperature, maxTokens);
    return { text, used: 'builtin' };
  }

  const zai = await withTimeout(getZai(), 20_000);
  if (!zai) throw new Error('не удалось инициализировать ИИ');
  const json: any = await withTimeout(
    zai.chat.completions.create({
      messages,
      stream: false,
      temperature,
      thinking: { type: 'disabled' },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    75_000,
  );
  if (!json) throw new Error('таймаут ответа ИИ');
  const text: string = json?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('пустой ответ ИИ');
  return { text, used: 'builtin' };
}

async function* builtinStream(messages: LlmMessage[], temperature: number): AsyncGenerator<string> {
  const mode = builtinMode();
  if (mode === 'none') throw new Error(NO_AI_MESSAGE);
  if (mode === 'env') {
    yield* openaiStream(envBackend()!, messages, temperature);
    return;
  }
  const zai = await withTimeout(getZai(), 20_000);
  if (!zai) throw new Error('инициализация ИИ не удалась');
  const stream: ReadableStream<Uint8Array> | null = await withTimeout(
    zai.chat.completions.create({
      messages,
      stream: true,
      temperature,
      thinking: { type: 'disabled' },
    }),
    60_000,
  );
  if (!stream) throw new Error('таймаут начала стрима');
  yield* readSse(stream);
}

/** Однократный (нестриминговый) вызов LLM с откатом на встроенный ИИ. */
export async function llmComplete(
  messages: LlmMessage[],
  opts: { backend?: BackendConfig | null; temperature?: number; maxTokens?: number } = {},
): Promise<LlmCallResult> {
  const { backend, temperature = 0.4, maxTokens } = opts;

  if (isCustomBackend(backend)) {
    try {
      const text = await openaiComplete(backend!, messages, temperature, maxTokens);
      return { text, used: 'custom' };
    } catch (e) {
      const reason = errMsg(e);
      if (builtinMode() === 'none') {
        return {
          text: '',
          used: 'custom',
          fallbackReason: `свой сервер недоступен (${reason}), а встроенный ИИ не настроен`,
        };
      }
      try {
        const fb = await builtinComplete(messages, temperature, maxTokens);
        return { ...fb, fallbackReason: `свой сервер недоступен (${reason}) — включён встроенный ИИ` };
      } catch (e2) {
        return { text: '', used: 'builtin', fallbackReason: `${reason}; встроенный ИИ: ${errMsg(e2)}` };
      }
    }
  }

  if (builtinMode() === 'none') {
    return { text: '', used: 'builtin', fallbackReason: NO_AI_MESSAGE };
  }
  // встроенный ИИ: одна повторная попытка при сбое/зависании
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await builtinComplete(messages, temperature, maxTokens);
    } catch (e) {
      if (attempt === 1) {
        return { text: '', used: 'builtin', fallbackReason: errMsg(e) };
      }
    }
  }
  return { text: '', used: 'builtin' };
}

/** Стриминговый вызов LLM: async-генератор текстовых дельт. */
export async function* llmStream(
  messages: LlmMessage[],
  opts: { backend?: BackendConfig | null; temperature?: number } = {},
): AsyncGenerator<{ delta?: string; fallbackNote?: string; done?: boolean }> {
  const { backend, temperature = 0.5 } = opts;
  let customNote = '';

  if (isCustomBackend(backend)) {
    let gotAny = false;
    try {
      for await (const delta of openaiStream(backend!, messages, temperature)) {
        gotAny = true;
        yield { delta };
      }
      if (gotAny) {
        yield { done: true };
        return;
      }
      throw new Error('поток без контента');
    } catch (e) {
      const reason = errMsg(e);
      if (gotAny) {
        // Ответ уже частично показан — второй ответ дописывать нельзя.
        yield {
          fallbackNote: `Ответ своего ИИ-сервера оборвался (${reason}). Повтори вопрос или выбери модель побыстрее.`,
        };
        yield { done: true };
        return;
      }
      customNote = `Свой ИИ-сервер недоступен (${reason}).`;
    }
  }

  if (builtinMode() === 'none') {
    yield { fallbackNote: customNote ? `${customNote} ${NO_AI_MESSAGE}` : NO_AI_MESSAGE };
    yield { done: true };
    return;
  }
  if (customNote) yield { fallbackNote: `${customNote} Отвечает встроенный ИИ.` };

  let gotAny = false;
  try {
    for await (const delta of builtinStream(messages, temperature)) {
      gotAny = true;
      yield { delta };
    }
    yield { done: true };
  } catch (e) {
    if (gotAny) {
      yield { fallbackNote: `Ответ оборвался (${errMsg(e)}). Повтори вопрос.` };
      yield { done: true };
      return;
    }
    // Стриминг не удался до первого токена — один обычный вызов
    try {
      const res = await builtinComplete(messages, temperature);
      if (res.text) yield { delta: res.text };
    } catch (e2) {
      yield { fallbackNote: `ИИ не ответил (${errMsg(e2)}).` };
    }
    yield { done: true };
  }
}

/** Достаёт JSON (объект или массив) из ответа LLM, даже если вокруг есть текст. */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  // убираем markdown-обёртки
  text = text.replace(/```(?:json)?/gi, '```');
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence && fence[1]) text = fence[1].trim();
  const direct = tryParse<T>(text);
  if (direct !== null) return direct;
  // ищем первый { или [
  for (const opener of ['{', '[']) {
    const start = text.indexOf(opener);
    if (start === -1) continue;
    for (let end = text.length; end > start; end--) {
      const candidate = text.slice(start, end);
      const parsed = tryParse<T>(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
