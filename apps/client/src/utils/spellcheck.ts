// Spellchecker utility for NotOS client.
// Combines instant offline dictionary for common typos, Yandex Speller online API for full dictionary checking,
// Electron native spellchecker APIs, and local persistence for ignored words.

const IGNORED_STORAGE_KEY = 'notoc_spellcheck_ignored';
const CACHE_STORAGE_KEY = 'notoc_spellcheck_cache';

let ignoredWords = new Set<string>();
try {
  const saved = localStorage.getItem(IGNORED_STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      ignoredWords = new Set(parsed.map((w: string) => String(w).toLowerCase()));
    }
  }
} catch {
  // Ignore localStorage read errors
}

// Built-in offline dictionary for common Russian mistakes and typos for instant, zero-latency corrections
const OFFLINE_COMMON_TYPOS: Record<string, string[]> = {
  'прывет': ['привет', 'превед'],
  'превет': ['привет'],
  'приветик': ['приветик'],
  'пака': ['пока'],
  'щас': ['сейчас'],
  'щаз': ['сейчас'],
  'спосибо': ['спасибо'],
  'спасиба': ['спасибо'],
  'пожалуста': ['пожалуйста'],
  'пожалуйсто': ['пожалуйста'],
  'пожалуйса': ['пожалуйста'],
  'здраствуйте': ['здравствуйте'],
  'здрасти': ['здравствуйте', 'здрасьте'],
  'здрасте': ['здравствуйте', 'здрасьте'],
  'че': ['что'],
  'чо': ['что'],
  'шо': ['что'],
  'каво': ['кого'],
  'чево': ['чего'],
  'вобще': ['вообще'],
  'вообщем': ['в общем', 'вообще'],
  'лудше': ['лучше'],
  'лутше': ['лучше'],
  'кароче': ['короче'],
  'короч': ['короче'],
  'сдесь': ['здесь'],
  'што': ['что'],
  'симпотичный': ['симпатичный'],
  'извените': ['извините'],
  'девченка': ['девчонка'],
  'мальчёнка': ['мальчонка'],
  'рассписание': ['расписание'],
  'будующий': ['будущий'],
  'выйграть': ['выиграть'],
  'ложить': ['класть', 'положить'],
  'езжай': ['поезжай'],
  'едь': ['поезжай'],
  'прийдти': ['прийти'],
  'ихний': ['их'],
  'евоный': ['его'],
  'еёный': ['её'],
  'агентсво': ['агентство'],
  'зделал': ['сделал'],
  'зделать': ['сделать'],
  'помойму': ['по-моему'],
  'помоему': ['по-моему'],
  'както': ['как-то'],
  'чтото': ['что-то'],
  'гдето': ['где-то'],
  'ктото': ['кто-то'],
  'почемуто': ['почему-то'],
  'зачемто': ['зачем-то'],
  'когдато': ['когда-то'],
  'попробывать': ['попробовать'],
  'пробывать': ['пробовать'],
  'учавствовать': ['участвовать'],
  'чуствовать': ['чувствовать'],
  'чювствовать': ['чувствовать'],
  'жызнь': ['жизнь'],
  'шырокий': ['широкий'],
  'чяшка': ['чашка'],
  'щястье': ['счастье'],
  'щастье': ['счастье'],
  'симпотично': ['симпатично'],
  'врядли': ['вряд ли'],
  'наврятли': ['навряд ли'],
  'точьно': ['точно'],
  'скучьно': ['скучно'],
  'красивоя': ['красивая'],
  'хорашо': ['хорошо'],
  'харашо': ['хорошо'],
  'севодня': ['сегодня'],
  'счас': ['сейчас'],
  'завтро': ['завтра'],
  'вчерась': ['вчера'],
  'нормално': ['нормально'],
  'понятна': ['понятно'],
  'окей': ["о'кей", 'хорошо'],
  'пачему': ['почему'],
  'патамушта': ['потому что'],
  'потомушта': ['потому что'],
  'потомушто': ['потому что']
};

export type CachedWord = {
  isMisspelled: boolean;
  suggestions: string[];
};

const wordCache = new Map<string, CachedWord>();

// Load cached words from sessionStorage
try {
  const savedCache = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CACHE_STORAGE_KEY) : null) ||
                     (typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_STORAGE_KEY) : null);
  if (savedCache) {
    const parsed = JSON.parse(savedCache);
    if (parsed && typeof parsed === 'object') {
      for (const [key, val] of Object.entries(parsed)) {
        if (val && typeof val === 'object') {
          wordCache.set(key, val as CachedWord);
        }
      }
    }
  }
} catch {
  // Ignore cache storage errors
}

function persistCache() {
  try {
    const obj: Record<string, CachedWord> = {};
    let count = 0;
    for (const [key, val] of wordCache.entries()) {
      if (count++ > 2000) break;
      obj[key] = val;
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Ignore
  }
}

const listeners = new Set<() => void>();

export function subscribeSpellcheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySpellcheckChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }
}

export function isWordIgnored(word: string): boolean {
  if (!word) return true;
  return ignoredWords.has(word.trim().toLowerCase());
}

export function ignoreWord(word: string) {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  ignoredWords.add(normalized);
  try {
    localStorage.setItem(IGNORED_STORAGE_KEY, JSON.stringify(Array.from(ignoredWords)));
  } catch {
    // Ignore localStorage write error
  }
  if (typeof window !== 'undefined' && window.notoc?.addWordToDictionary) {
    void window.notoc.addWordToDictionary(word.trim());
  }
  notifySpellcheckChanged();
}

function matchCase(original: string, suggestion: string): string {
  if (!original || !suggestion) return suggestion;
  if (original === original.toUpperCase() && original.length > 1) {
    return suggestion.toUpperCase();
  }
  const first = original.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

export function isWordMisspelled(word: string): boolean {
  if (!word || word.length < 2) return false;
  if (/\d/.test(word)) return false;
  const lower = word.toLowerCase();
  if (isWordIgnored(lower)) return false;

  // Offline dictionary check
  if (OFFLINE_COMMON_TYPOS[lower]) {
    return true;
  }

  // Cache check
  const cached = wordCache.get(lower);
  if (cached) {
    return cached.isMisspelled;
  }

  // Native Electron spellcheck if active
  if (typeof window !== 'undefined' && window.notoc?.isWordMisspelled) {
    try {
      if (window.notoc.isWordMisspelled(word)) {
        return true;
      }
    } catch {
      // Ignore
    }
  }

  return false;
}

export function getWordSuggestions(word: string): string[] {
  if (!word) return [];
  const lower = word.toLowerCase();

  // Cache check
  const cached = wordCache.get(lower);
  if (cached && cached.suggestions && cached.suggestions.length > 0) {
    return cached.suggestions.map((s) => matchCase(word, s));
  }

  // Offline dictionary
  if (OFFLINE_COMMON_TYPOS[lower]) {
    return OFFLINE_COMMON_TYPOS[lower].map((s) => matchCase(word, s));
  }

  // Native Electron suggestions
  if (typeof window !== 'undefined' && window.notoc?.getWordSuggestions) {
    try {
      const raw = window.notoc.getWordSuggestions(word);
      if (raw && raw.length > 0) {
        return raw.slice(0, 8).map((s) => matchCase(word, s));
      }
    } catch {
      // Ignore
    }
  }

  return [];
}

export async function fetchWordSuggestionsAsync(word: string): Promise<string[]> {
  if (!word || isWordIgnored(word)) return [];
  const existing = getWordSuggestions(word);
  if (existing.length > 0) return existing;

  const lower = word.toLowerCase();
  try {
    const res = await fetch(`https://speller.yandex.net/services/spellservice.json/checkText?text=${encodeURIComponent(word)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].s)) {
      const suggestions = data[0].s;
      wordCache.set(lower, {
        isMisspelled: true,
        suggestions
      });
      persistCache();
      notifySpellcheckChanged();
      return suggestions.map((s: string) => matchCase(word, s));
    } else {
      wordCache.set(lower, {
        isMisspelled: false,
        suggestions: []
      });
      persistCache();
      notifySpellcheckChanged();
      return [];
    }
  } catch {
    return [];
  }
}

let checkTimer: any = null;
let lastCheckedText = '';

export function requestSpellcheck(text: string) {
  if (typeof window === 'undefined') return;
  if (!text || text.trim() === '') return;
  if (text === lastCheckedText) return;

  if (checkTimer) {
    clearTimeout(checkTimer);
  }

  checkTimer = setTimeout(() => {
    void performOnlineCheck(text);
  }, 250);
}

async function performOnlineCheck(text: string) {
  lastCheckedText = text;

  TOKEN_REGEX.lastIndex = 0;
  const words: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_REGEX.exec(text)) !== null) {
    const w = m[3];
    if (w && w.length >= 2 && !/\d/.test(w) && !isWordIgnored(w)) {
      words.push(w);
    }
  }

  if (words.length === 0) return;

  const uncachedWords = words.filter((w) => !wordCache.has(w.toLowerCase()));
  if (uncachedWords.length === 0) return;

  const textToCheck = uncachedWords.join(' ');

  try {
    const res = await fetch(`https://speller.yandex.net/services/spellservice.json/checkText?text=${encodeURIComponent(textToCheck)}`);
    if (!res.ok) return;
    const errors: Array<{ word: string; s: string[] }> = await res.json();

    const misspelledMap = new Map<string, string[]>();
    for (const err of errors) {
      if (err.word) {
        misspelledMap.set(err.word.toLowerCase(), err.s || []);
      }
    }

    let hasNewChanges = false;
    for (const w of uncachedWords) {
      const lower = w.toLowerCase();
      if (misspelledMap.has(lower)) {
        wordCache.set(lower, {
          isMisspelled: true,
          suggestions: misspelledMap.get(lower) || []
        });
        hasNewChanges = true;
      } else {
        wordCache.set(lower, {
          isMisspelled: false,
          suggestions: []
        });
      }
    }

    persistCache();
    if (hasNewChanges) {
      notifySpellcheckChanged();
    }
  } catch {
    // Offline / network failure fallback
  }
}

export type TextSpellingToken = {
  text: string;
  isMisspelled: boolean;
};

// Match URLs, email addresses, and words composed of letters
const TOKEN_REGEX = /(https?:\/\/[^\s]+)|([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)|([\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*)/gu;

export function tokenizeForSpellcheck(text: string): TextSpellingToken[] {
  if (!text) return [];
  const tokens: TextSpellingToken[] = [];
  let lastIndex = 0;
  TOKEN_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];

    // Non-word segment before this match
    if (matchStart > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, matchStart),
        isMisspelled: false
      });
    }

    const wordMatch = match[3];
    if (wordMatch && isWordMisspelled(wordMatch)) {
      tokens.push({
        text: wordMatch,
        isMisspelled: true
      });
    } else {
      tokens.push({
        text: matchText,
        isMisspelled: false
      });
    }

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      isMisspelled: false
    });
  }

  return tokens;
}

export type WordAtOffsetInfo = {
  word: string;
  start: number;
  end: number;
  isMisspelled: boolean;
  suggestions: string[];
};

export function getWordAtOffset(text: string, offset: number): WordAtOffsetInfo | null {
  if (!text) return null;
  const clampedOffset = Math.max(0, Math.min(offset, text.length));

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let closest: { word: string; start: number; end: number; dist: number } | null = null;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const word = match[3];
    if (!word) continue;
    const start = match.index + match[0].indexOf(word);
    const end = start + word.length;

    // Offset inside or right at boundaries
    if (clampedOffset >= start && clampedOffset <= end) {
      const misspelled = isWordMisspelled(word);
      const suggestions = getWordSuggestions(word);
      return {
        word,
        start,
        end,
        isMisspelled: misspelled || suggestions.length > 0,
        suggestions
      };
    }

    // Nearest word within 4 characters
    const dist = clampedOffset < start ? start - clampedOffset : clampedOffset - end;
    if (dist <= 4 && (!closest || dist < closest.dist)) {
      closest = { word, start, end, dist };
    }
  }

  if (closest) {
    const misspelled = isWordMisspelled(closest.word);
    const suggestions = getWordSuggestions(closest.word);
    return {
      word: closest.word,
      start: closest.start,
      end: closest.end,
      isMisspelled: misspelled || suggestions.length > 0,
      suggestions
    };
  }

  return null;
}
