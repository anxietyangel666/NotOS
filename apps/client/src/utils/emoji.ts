const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72';

export function emojiToTwemojiUrl(emoji: string): string | null {
  if (!emoji) return null;
  let codePoints = Array.from(emoji).map(c => c.codePointAt(0));
  if (codePoints.some(cp => cp === undefined)) return null;
  while (codePoints.length > 0 && codePoints[codePoints.length - 1] === 0xFE0F && codePoints.length > 1) {
    codePoints.pop();
  }
  const hex = codePoints.map(cp => cp!.toString(16)).join('-');
  return `${TWEMOJI_BASE}/${hex}.png`;
}

const emojiRe = /([\u{1F1E6}-\u{1F1FF}][\u{1F1E6}-\u{1F1FF}])|[\u{2600}-\u{27BF}]\uFE0F|(\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F\u20E3?|\u200D(?:[\u{2600}-\u{27BF}]\uFE0F|\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji_Modifier_Base}\p{Emoji_Modifier})?)*/gu;

export function splitEmojiText(text: string): Array<{ type: 'emoji' | 'text'; value: string }> {
  const parts: Array<{ type: 'emoji' | 'text'; value: string }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(emojiRe)) {
    if (match.index! > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'emoji', value: match[0] });
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}
