// Диагностика: что реально настроено на этом компьютере (без раскрытия ключей).

import { NextResponse } from 'next/server';
import { builtinMode } from '@/lib/llm';
import { searchMode } from '@/lib/web';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ builtin: builtinMode(), search: searchMode() });
}
