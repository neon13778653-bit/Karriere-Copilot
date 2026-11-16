// SSE-хелпер: превращает async-генератор событий в потоковый Response

import type { AgentEvent, BackendConfig } from './types';

export function sseResponse(gen: AsyncGenerator<AgentEvent>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let lastWasDone = false;
      try {
        for await (const evt of gen) {
          lastWasDone = evt.type === 'done';
          controller.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'неизвестная ошибка';
        try {
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ type: 'error', message: `Внутренняя ошибка: ${message}` })}\n\n`),
          );
        } catch {
          // контроллер уже закрыт
        }
      } finally {
        if (!lastWasDone) {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          } catch {
            // игнорируем
          }
        }
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

const PROVIDERS = ['builtin', 'ollama', 'lmstudio', 'groq', 'openrouter', 'custom'];

export function readBackend(body: any): BackendConfig | null {
  const backend = body?.backend;
  if (backend && typeof backend.provider === 'string' && PROVIDERS.includes(backend.provider)) {
    return {
      provider: backend.provider as BackendConfig['provider'],
      customUrl: typeof backend.customUrl === 'string' ? backend.customUrl : undefined,
      customKey: typeof backend.customKey === 'string' ? backend.customKey : undefined,
      customModel: typeof backend.customModel === 'string' ? backend.customModel : undefined,
    };
  }
  return null;
}
