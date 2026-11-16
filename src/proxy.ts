// Защита API локального приложения (в Next 16 бывший middleware называется proxy).
// Приложение хранит резюме и личные данные без авторизации, поэтому /api/* отвечает только:
//   1) запросам, где Host — localhost / 127.0.0.1 / [::1] (защита от DNS rebinding и доступа из сети);
//   2) запросам изменяющего типа, у которых Origin (если он есть) совпадает с Host (защита от CSRF).
// Если приложение осознанно открывается с другого адреса — перечисли хосты в ALLOWED_HOSTS (через запятую).

import { NextResponse, type NextRequest } from 'next/server';

const BUILTIN_ALLOWED = ['localhost', '127.0.0.1', '[::1]'];

function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // IPv6 в скобках
  return h.replace(/:\d+$/, '');
}

export function proxy(req: NextRequest) {
  const allowed = new Set([
    ...BUILTIN_ALLOWED,
    ...(process.env.ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ]);

  const hostHeader = req.headers.get('host') || '';
  if (!allowed.has(hostname(hostHeader))) {
    return NextResponse.json(
      { error: 'Доступ к API только с этого компьютера. Другой адрес добавь в ALLOWED_HOSTS.' },
      { status: 403 },
    );
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.get('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        // некорректный Origin — отклоняем ниже
      }
      if (originHost !== hostHeader.trim().toLowerCase()) {
        return NextResponse.json({ error: 'Запрос с чужого сайта отклонён.' }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
