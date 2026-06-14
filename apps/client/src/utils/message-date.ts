import type { Language } from '../api/types';
import { LOCALES, t } from '../i18n';

// Returns a YYYY-MM-DD key based on the local calendar day. Used to decide when
// a date divider should be inserted between two consecutive messages.
export function dayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Human-readable label for a date divider: "Today", "Yesterday", or a full
// localized date for anything older than one day.
export function formatMessageDate(value: string | Date, language: Language): string {
  const date = value instanceof Date ? value : new Date(value);
  const key = dayKey(date);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (key === dayKey(now)) return t(language, 'today');
  if (key === dayKey(yesterday)) return t(language, 'yesterday');

  return new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date);
}

// Whether a date divider should be rendered before `current` given the
// previous message in the list (or null for the first message).
export function shouldShowDateDivider(current: string | Date, previous: string | Date | null): boolean {
  if (!previous) return true;
  return dayKey(current) !== dayKey(previous);
}
