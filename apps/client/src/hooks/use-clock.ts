import { useEffect, useState } from 'react';
import type { Language } from '../api/types';
import { LOCALES, type TimeFormat } from '../i18n';

export function useClock(language: Language, timeFormat: TimeFormat) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    time: new Intl.DateTimeFormat(LOCALES[language], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h'
    }).format(now),
    date: new Intl.DateTimeFormat(LOCALES[language], {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(now)
  };
}
