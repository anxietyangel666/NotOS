// Renders [game:<kind>:<base64url-json>] marker messages (/roll, /coin,
// /8ball, /pick). The full result is baked into the marker by the server, so
// this component parses locally and never fetches — rendering is instant and
// the reveal animation is pure CSS.
import { useMemo } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

const GAME_MARKER_RE = /^\[game:(roll|coin|8ball|pick):([A-Za-z0-9_-]+)\]$/;

type GamePayload =
  | { kind: 'roll'; rolls?: number[]; sides?: number; total?: number; min?: number; max?: number; value?: number }
  | { kind: 'coin'; flips: Array<'heads' | 'tails'> }
  | { kind: '8ball'; q: string; answer: number }
  | { kind: 'pick'; options?: string[]; winner?: number; member?: string; count?: number };

export function parseGameBody(body: string): GamePayload | null {
  const match = GAME_MARKER_RE.exec(body.trim());
  if (!match) return null;
  try {
    const payload = JSON.parse(atob(match[2].replace(/-/g, '+').replace(/_/g, '/')));
    return { kind: match[1], ...payload } as GamePayload;
  } catch {
    return null;
  }
}

// Short label for conversation-list previews.
export function gamePreviewLabel(body: string, language: Language): string | null {
  const game = parseGameBody(body);
  if (!game) return null;
  if (game.kind === 'roll') return `🎲 ${t(language, 'gameRoll')}`;
  if (game.kind === 'coin') return `🪙 ${t(language, 'gameCoin')}`;
  if (game.kind === '8ball') return `🎱 ${t(language, 'gameEightBall')}`;
  return `🎯 ${t(language, 'gamePick')}`;
}

// Magic 8-ball phrase table (20 per language, indexed by the server's roll).
const EIGHT_BALL: Record<Language, string[]> = {
  en: [
    'It is certain', 'Without a doubt', 'Yes — definitely', 'You may rely on it', 'Most likely',
    'Outlook good', 'Yes', 'Signs point to yes', 'Reply hazy, try again', 'Ask again later',
    'Better not tell you now', 'Cannot predict now', 'Concentrate and ask again', "Don't count on it",
    'My reply is no', 'My sources say no', 'Outlook not so good', 'Very doubtful', 'Absolutely not', 'Ask someone else'
  ],
  ru: [
    'Бесспорно', 'Без сомнений', 'Определённо да', 'Можешь положиться на это', 'Скорее всего',
    'Перспективы хорошие', 'Да', 'Знаки говорят — да', 'Туманно, попробуй ещё раз', 'Спроси позже',
    'Лучше не рассказывать', 'Сейчас не предскажешь', 'Сконцентрируйся и спроси снова', 'Не рассчитывай на это',
    'Мой ответ — нет', 'Мои источники говорят нет', 'Перспективы не очень', 'Весьма сомнительно', 'Точно нет', 'Спроси кого-нибудь другого'
  ],
  uk: [
    'Безперечно', 'Без сумнівів', 'Однозначно так', 'Можеш на це покластися', 'Скоріш за все',
    'Перспективи гарні', 'Так', 'Знаки кажуть — так', 'Туманно, спробуй ще раз', 'Запитай пізніше',
    'Краще не казати', 'Зараз не передбачити', 'Зосередься і запитай знову', 'Не розраховуй на це',
    'Моя відповідь — ні', 'Мої джерела кажуть ні', 'Перспективи не дуже', 'Дуже сумнівно', 'Точно ні', 'Запитай когось іншого'
  ]
};

export function GameEmbed({ game, language }: { game: GamePayload; language: Language }) {
  const content = useMemo(() => {
    if (game.kind === 'roll') {
      if (typeof game.value === 'number') {
        return (
          <>
            <div className="game-embed-head"><span className="game-embed-icon game-reveal" aria-hidden="true">🎲</span><strong>{game.min}–{game.max}</strong></div>
            <div className="game-embed-result game-reveal-late">{game.value}</div>
          </>
        );
      }
      const rolls = game.rolls ?? [];
      return (
        <>
          <div className="game-embed-head">
            <span className="game-embed-icon game-reveal" aria-hidden="true">🎲</span>
            <strong>{rolls.length}d{game.sides}</strong>
          </div>
          <div className="game-embed-dice game-reveal-late">
            {rolls.map((roll, index) => <span key={index} className="game-die">{roll}</span>)}
          </div>
          {rolls.length > 1 ? (
            <div className="game-embed-footer">{t(language, 'gameTotal')}: <strong>{game.total}</strong></div>
          ) : null}
        </>
      );
    }
    if (game.kind === 'coin') {
      return (
        <>
          <div className="game-embed-head"><span className="game-embed-icon game-flip" aria-hidden="true">🪙</span><strong>{t(language, 'gameCoin')}</strong></div>
          <div className="game-embed-result game-reveal-late">
            {game.flips.map((flip) => t(language, flip === 'heads' ? 'coinHeads' : 'coinTails')).join(' · ')}
          </div>
        </>
      );
    }
    if (game.kind === '8ball') {
      const answers = EIGHT_BALL[language] ?? EIGHT_BALL.en;
      return (
        <>
          <div className="game-embed-head"><span className="game-embed-icon game-reveal" aria-hidden="true">🎱</span><em className="game-embed-question">{game.q}</em></div>
          <div className="game-embed-result game-reveal-late">{answers[game.answer % answers.length]}</div>
        </>
      );
    }
    if (typeof game.member === 'string') {
      return (
        <>
          <div className="game-embed-head"><span className="game-embed-icon game-reveal" aria-hidden="true">🎯</span><strong>{t(language, 'gamePickChose')}</strong></div>
          <div className="game-embed-result game-reveal-late">{game.member}</div>
          <div className="game-embed-footer">{t(language, 'gamePickOf', { count: String(game.count ?? 0) })}</div>
        </>
      );
    }
    const options = game.options ?? [];
    return (
      <>
        <div className="game-embed-head"><span className="game-embed-icon game-reveal" aria-hidden="true">🎯</span><strong>{t(language, 'gamePickChose')}</strong></div>
        <div className="game-embed-options">
          {options.map((option, index) => (
            <span key={index} className={index === game.winner ? 'game-embed-option winner game-reveal-late' : 'game-embed-option'}>
              {option}
            </span>
          ))}
        </div>
      </>
    );
  }, [game, language]);

  return <div className="game-embed">{content}</div>;
}
