// Проверка своего ИИ-бэкенда (Ollama / OpenAI-совместимый сервер)

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url: string = (body?.url || '').trim().replace(/\/+$/, '');
  const key: string = (body?.key || '').trim();
  const model: string = (body?.model || '').trim();

  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { ok: false, message: 'Укажи корректный URL (например http://localhost:11434/v1)' },
      { status: 200 },
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'default',
        messages: [{ role: 'user', content: 'Ответь одним словом: pong' }],
        max_tokens: 10,
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({
        ok: false,
        message: `Сервер ответил ошибкой ${res.status}. ${text.slice(0, 200)}`,
      });
    }
    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
      return NextResponse.json({ ok: false, message: 'Сервер ответил, но контент пуст. Проверь имя модели.' });
    }
    return NextResponse.json({
      ok: true,
      message: `Соединение работает! Ответ модели: «${content.trim().slice(0, 80)}»`,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'неизвестная ошибка';
    return NextResponse.json({
      ok: false,
      message: `Не удалось подключиться (${reason}). Если приложение открыто в облаке — локальный сервер (localhost) из него недоступен; встроенный ИИ продолжит работу.`,
    });
  }
}
