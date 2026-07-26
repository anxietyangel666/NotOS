// Renders [game:<kind>:<base64url-json>] marker messages (/roll, /coin,
// /8ball, /pick). The full result is baked into the marker by the server, so
// this component parses locally and never fetches — rendering is instant and
// the reveal animation is pure CSS.
import { useMemo, type CSSProperties } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

// ── Real 3D dice and coins ───────────────────────────────────────────────────
// A CSS cube / coin flipped by compositor-only transform keyframes that land
// on the server-rolled result. The final orientation is passed via CSS vars.

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[32, 26], [32, 50], [32, 74], [68, 26], [68, 50], [68, 74]]
};

function DieFacePips({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {PIPS[value].map(([x, y], index) => <circle key={index} cx={x} cy={y} r="10.5" />)}
    </svg>
  );
}

// Cube rotation that brings the rolled face to the front.
const DIE_ORIENTATION: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180]
};

function Die3D({ value, delayMs }: { value: number; delayMs: number }) {
  const [rx, ry] = DIE_ORIENTATION[value] ?? [0, 0];
  return (
    <span
      className="die3d-scene"
      style={{ '--fx': `${rx}deg`, '--fy': `${ry}deg`, '--delay': `${delayMs}ms` } as CSSProperties}
    >
      <span className="die3d">
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <span key={face} className={`die3d-face die3d-face-${face}`}>
            <DieFacePips value={face} />
          </span>
        ))}
      </span>
    </span>
  );
}

function CoinFace({ side }: { side: 'heads' | 'tails' }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" className="coin3d-rim" />
      <circle cx="50" cy="50" r="47" className="coin3d-ridge" strokeDasharray="2.4 2.8" />
      <circle cx="50" cy="50" r="37" className="coin3d-inner" />
      {side === 'heads' ? (
        // Radiating star emblem for heads.
        <g className="coin3d-emblem">
          <path d="M50 22l6.5 17.5L74 42l-14 11 5 18-15-10.5L35 71l5-18-14-11 17.5-2.5z" />
        </g>
      ) : (
        // Wreathed "1" for tails.
        <g className="coin3d-emblem">
          <path d="M46 30l10-5v50h-9V38l-7 3z" />
          <path d="M28 62c2 8 6 12 10 14M72 62c-2 8-6 12-10 14" fill="none" strokeWidth="4" strokeLinecap="round" className="coin3d-wreath" />
        </g>
      )}
    </svg>
  );
}

function Coin3D({ result, delayMs }: { result: 'heads' | 'tails'; delayMs: number }) {
  // Five full spins, plus a half turn when tails must face the viewer.
  const finalY = result === 'heads' ? 1800 : 1980;
  return (
    <span className="coin3d-scene" style={{ '--fy': `${finalY}deg`, '--delay': `${delayMs}ms` } as CSSProperties}>
      <span className="coin3d">
        <span className="coin3d-face coin3d-front"><CoinFace side="heads" /></span>
        <span className="coin3d-face coin3d-back"><CoinFace side="tails" /></span>
      </span>
    </span>
  );
}

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
      // Six-sided dice tumble as real 3D cubes; exotic dice keep number chips.
      const realDice = game.sides === 6;
      return (
        <>
          <div className="game-embed-head">
            <strong>{rolls.length}d{game.sides}</strong>
          </div>
          {realDice ? (
            <div className="game-embed-dice3d">
              {rolls.map((roll, index) => <Die3D key={index} value={roll} delayMs={index * 160} />)}
            </div>
          ) : (
            <div className="game-embed-dice game-reveal-late">
              {rolls.map((roll, index) => <span key={index} className="game-die">{roll}</span>)}
            </div>
          )}
          {rolls.length > 1 ? (
            <div className="game-embed-footer game-footer-after-roll">{t(language, 'gameTotal')}: <strong>{game.total}</strong></div>
          ) : null}
        </>
      );
    }
    if (game.kind === 'coin') {
      return (
        <>
          <div className="game-embed-head"><strong>{t(language, 'gameCoin')}</strong></div>
          <div className="game-embed-coins">
            {game.flips.map((flip, index) => <Coin3D key={index} result={flip} delayMs={index * 220} />)}
          </div>
          <div className="game-embed-result game-footer-after-flip">
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
