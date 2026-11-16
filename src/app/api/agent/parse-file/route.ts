// Извлечение текста из приложенных документов (Lebenslauf, аттестаты, сертификаты).
// Поддержка: PDF (unpdf), DOCX (mammoth), TXT/MD, RTF. Результат читает агент.

import { NextResponse } from 'next/server';

const MAX_SIZE = 10 * 1024 * 1024; // 10 МБ
const MAX_TEXT = 12_000; // символов на документ — хватит для Lebenslauf

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

async function extract(buf: Buffer, ext: string): Promise<{ text: string; note?: string }> {
  if (ext === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n\n') : text;
    return {
      text: cleanText(merged),
      note: `PDF, страниц: ${totalPages}`,
    };
  }

  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: cleanText(value), note: 'DOCX' };
  }

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    return { text: cleanText(buf.toString('utf8')), note: 'текстовый файл' };
  }

  if (ext === 'rtf') {
    const raw = buf.toString('utf8');
    const stripped = raw
      .replace(/\\'([0-9a-fA-F]{2})/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
      .replace(/[{}]/g, ' ');
    return { text: cleanText(stripped), note: 'RTF' };
  }

  if (ext === 'doc') {
    throw new Error(
      'Старый формат .doc не читается — пересохрани файл как .docx или .pdf',
    );
  }

  // Пытаемся прочитать как текст (для нестандартных расширений)
  const guess = buf.toString('utf8');
  const printable = guess.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, '');
  if (printable.length > Math.max(80, guess.length * 0.7)) {
    return { text: cleanText(printable), note: 'текстовый файл' };
  }
  throw new Error(
    'Не удалось прочитать файл — поддерживаются PDF, DOCX, TXT и RTF',
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name: string = typeof body?.name === 'string' ? body.name : '';
  const base64: string = typeof body?.data === 'string' ? body.data : '';

  if (!name || !base64) {
    return NextResponse.json({ ok: false, error: 'Нет файла' }, { status: 400 });
  }

  const size = Math.floor((base64.length * 3) / 4);
  if (size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, error: 'Файл больше 10 МБ' },
      { status: 400 },
    );
  }

  try {
    const buf = Buffer.from(base64, 'base64');
    const { text, note } = await extract(buf, extOf(name));
    if (!text || text.length < 10) {
      return NextResponse.json({
        ok: false,
        error: 'В файле не найден читаемый текст — возможно, это скан без текстового слоя',
      });
    }
    return NextResponse.json({
      ok: true,
      text,
      note: note ? `${note}, распознано ${text.length} символов` : `распознано ${text.length} символов`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'Не удалось прочитать файл',
    });
  }
}
