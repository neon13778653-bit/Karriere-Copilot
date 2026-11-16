// Очистка текста агента от «несерьёзных» декоративных эмодзи (🔥🎯👋⚖️⚡📍👤 и т.п.).
// Применяется при сохранении сообщений, карточек вакансий и при рендере,
// чтобы агент всегда выглядел строго и по делу.

const EMOJI_CHARS = [
  '[\\u{1F000}-\\u{1FAFF}]', // все эмодзи-блоки: фигуры, огонь, цели, лица, флаги, машины…
  '[\\u{2600}-\\u{27BF}]', // miscellaneous symbols + dingbats (⚡⚖📍🎯…)
  '[\\u{2B00}-\\u{2BFF}]', // звёзды, декоративные стрелки (⭐⬆…)
  '[\\u{231A}-\\u{231B}]', // часы-эмодзи
  '[\\u{23E9}-\\u{23FA}]', // мультимедийные символы (⏱⏰…)
  '[\\u{2049}\\u{203C}]', // ‼ ⁉
  '[\\u{FE0F}\\u{FE0E}]', // variation selectors
  '[\\u{200D}]', // zero-width joiner (составные эмодзи)
].join('|');

// Без «g» — чтобы .test() не зависел от lastIndex.
const EMOJI_TEST = new RegExp(EMOJI_CHARS, 'u');
const EMOJI_GLOBAL = new RegExp(EMOJI_CHARS, 'gu');

/**
 * Убирает декоративные эмодзи из текста (включая markdown-сообщения).
 * Строки, состоявшие только из эмодзи, удаляются целиком;
 * пустые строки между абзацами и структура текста сохраняются.
 */
export function stripDecorativeEmojis(text: string): string {
  if (!text) return text;
  const hadEmoji = (line: string) => EMOJI_TEST.test(line);
  const lines = text.split('\n').map((line) => {
    if (!hadEmoji(line)) return line;
    return line
      .replace(EMOJI_GLOBAL, '')
      // эмодзи часто стоял вплотную к ** — убираем пробелы, разрывавшие жирный/курсив
      .replace(/([*_]{2})[ \t]+([^*_\n]+?)[ \t]*\1/g, '$1$2$1')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.!?;:])/g, '$1')
      .trim();
  });
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && out.length && out[out.length - 1] === '') continue; // без дублей пустых строк
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/^\n+/, '')
    .trim();
}
