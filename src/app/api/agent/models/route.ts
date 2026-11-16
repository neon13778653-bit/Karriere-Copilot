// Загрузка списка моделей с OpenAI-совместимого сервера
// (Ollama, LM Studio, GroqCloud, OpenRouter, vLLM, OpenAI...)

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url: string = (body?.url || '').trim().replace(/\/+$/, '');
  const key: string = (body?.key || '').trim();

  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { ok: false, message: 'Укажи корректный Base URL (например http://localhost:11434/v1)', models: [] },
      { status: 200 },
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  try {
    const res = await fetch(`${url}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({
        ok: false,
        message: `Сервер ответил ошибкой ${res.status}. ${text.slice(0, 160)}`,
        models: [],
      });
    }
    const json = await res.json();
    const raw: unknown[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    const models: string[] = raw
      .map((m: any) =>
        typeof m === 'string' ? m : typeof m?.id === 'string' ? m.id : typeof m?.name === 'string' ? m.name : null,
      )
      .filter((m): m is string => !!m)
      .slice(0, 200);
    if (!models.length) {
      return NextResponse.json({
        ok: false,
        message: 'Сервер ответил, но список моделей пуст. Проверь, запущена ли модель (ollama run …).',
        models: [],
      });
    }
    return NextResponse.json({
      ok: true,
      message: `Найдено моделей: ${models.length}`,
      models,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'неизвестная ошибка';
    return NextResponse.json({
      ok: false,
      message: `Не удалось получить список моделей (${reason}).`,
      models: [],
    });
  }
}
