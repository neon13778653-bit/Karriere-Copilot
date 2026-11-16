// Смоук-тест LLM-слоя и веб-слоя (без БД и Next). Запуск: bun scripts/llm-smoke.ts  (или npx tsx ...)
// Поднимает фейковый OpenAI-совместимый сервер и проверяет таймауты потока, откаты и защиту от SSRF.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.LLM_FIRST_TOKEN_TIMEOUT_MS = '1500';
process.env.LLM_STREAM_IDLE_TIMEOUT_MS = '800';
process.env.LLM_BASE_URL = '';
process.env.SEARXNG_URL = '';
process.env.BRAVE_API_KEY = '';

let failed = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

function sse(res: http.ServerResponse, text: string) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/slow/')) {
      // живой поток, который в сумме идёт дольше таймаута бездействия (800 мс), но паузы короткие
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let i = 0;
      const t = setInterval(() => {
        sse(res, `часть${i} `);
        if (++i === 8) {
          clearInterval(t);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 400); // 8 * 400 = 3.2 с в сумме, дольше таймаута первого токена (1.5 с): общий срок ответа не ограничен
    } else if (req.url?.startsWith('/stall/')) {
      // начал отвечать и замолчал
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      sse(res, 'начало ');
      sse(res, 'ответа ');
    } else if (req.url?.startsWith('/search')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [{ url: 'https://example.com/job', title: 'Job', content: 'Fachinformatiker' }, { url: 'ftp://x', title: 'bad' }] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const { llmStream, builtinMode } = await import('../src/lib/llm');
  const web = await import('../src/lib/web');

  check('без настроек встроенного ИИ нет', builtinMode() === 'none');

  // 1) длинный, но живой поток не обрывается
  let text = '';
  let note = '';
  for await (const c of llmStream([{ role: 'user', content: 'hi' }], { backend: { provider: 'custom', customUrl: `${base}/slow` } })) {
    if (c.delta) text += c.delta;
    if (c.fallbackNote) note += c.fallbackNote;
  }
  check('длинный живой поток дочитан целиком', text.includes('часть7') && !note, `получено ${text.length} симв.`);

  // 2) замолчавший поток: оборван с пояснением, второй ответ НЕ дописывается
  text = '';
  note = '';
  for await (const c of llmStream([{ role: 'user', content: 'hi' }], { backend: { provider: 'custom', customUrl: `${base}/stall` } })) {
    if (c.delta) text += c.delta;
    if (c.fallbackNote) note += c.fallbackNote;
  }
  check('замолчавший поток: частичный текст сохранён', text === 'начало ответа ', JSON.stringify(text));
  check('замолчавший поток: есть пояснение об обрыве', /оборвался/.test(note), note);

  // 3) недоступный сервер и нет встроенного ИИ: понятная подсказка, а не молчание
  note = '';
  text = '';
  for await (const c of llmStream([{ role: 'user', content: 'hi' }], { backend: { provider: 'custom', customUrl: 'http://127.0.0.1:1/v1' } })) {
    if (c.delta) text += c.delta;
    if (c.fallbackNote) note += c.fallbackNote;
  }
  check('недоступный сервер: подсказка про настройку', /не настроен/.test(note) && !text, note.slice(0, 90));

  // 4) поиск
  check('без провайдера поиск = none', web.searchMode() === 'none');
  check('без провайдера webSearch возвращает []', (await web.webSearch('x')).length === 0);
  process.env.SEARXNG_URL = base;
  check('SEARXNG_URL включает searxng', web.searchMode() === 'searxng');
  const hits = await web.webSearch('Fachinformatiker Frankfurt', 5);
  check('SearXNG: только http(s)-ссылки, формат WebHit', hits.length === 1 && hits[0].host_name === 'example.com' && hits[0].rank === 1);

  // 5) чтение страниц: локальные и приватные адреса запрещены
  for (const u of ['http://127.0.0.1/', 'http://localhost:3000/api/memory', 'http://169.254.169.254/latest/meta-data', 'http://192.168.0.1/', 'http://[::1]/', 'file:///etc/passwd']) {
    check(`readPage блокирует ${u}`, (await web.readPage(u)) === null);
  }

  server.closeAllConnections?.();
  server.close();
  console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВСЕ ПРОВЕРКИ LLM/WEB ПРОЙДЕНЫ');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
