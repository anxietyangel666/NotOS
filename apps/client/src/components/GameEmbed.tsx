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

// Crystal-style die for non-cube rolls (d20, ranges): a faceted hexagon with
// the number engraved.
function CrystalDie({ value, delayMs }: { value: number; delayMs: number }) {
  return (
    <span className="game-crystal" style={{ '--delay': `${delayMs}ms` } as CSSProperties}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon points="50,3 93,26 93,74 50,97 7,74 7,26" className="game-crystal-body" />
        <polygon points="50,3 93,26 50,50 7,26" className="game-crystal-facet" />
        <polygon points="93,74 50,97 50,50" className="game-crystal-facet dark" />
        <text x="50" y="63" textAnchor="middle" className="game-crystal-num">{value}</text>
      </svg>
    </span>
  );
}

// Glossy magic 8-ball.
function EightBall() {
  return (
    <span className="game-ball">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="47" className="game-ball-body" />
        <ellipse cx="36" cy="30" rx="18" ry="12" className="game-ball-shine" />
        <circle cx="50" cy="46" r="17" className="game-ball-window" />
        <text x="50" y="55" textAnchor="middle" className="game-ball-eight">8</text>
      </svg>
    </span>
  );
}

// Dartboard for /pick.
function PickTarget() {
  return (
    <span className="game-target">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" className="game-target-red" />
        <circle cx="50" cy="50" r="34" className="game-target-white" />
        <circle cx="50" cy="50" r="22" className="game-target-red" />
        <circle cx="50" cy="50" r="10" className="game-target-white" />
        <circle cx="50" cy="50" r="4" className="game-target-red" />
        <path d="M50 50 76 18" className="game-target-dart" />
        <path d="M76 18l6-10 2 8 8 2-10 6z" className="game-target-flight" />
      </svg>
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
  ],
  zh: [
    '毫无疑问', '毋庸置疑', '肯定是的', '可以放心', '很可能',
    '前景不错', '是的', '种种迹象表明是', '答案模糊，再试一次', '稍后再问',
    '现在最好不告诉你', '现在无法预测', '集中精神再问一次', '别指望了',
    '我的答案是不', '我的消息来源说不', '前景不太妙', '非常可疑', '绝对不行', '去问问别人吧'
  ],
  'zh-TW': [
    '毫無疑問', '毋庸置疑', '肯定是的', '可以放心', '很可能',
    '前景不錯', '是的', '種種跡象表明是', '答案模糊，再試一次', '稍後再問',
    '現在最好不告訴你', '現在無法預測', '集中精神再問一次', '別指望了',
    '我的答案是不', '我的消息來源說不', '前景不太妙', '非常可疑', '絕對不行', '去問問別人吧'
  ]
};

export function GameEmbed({ game, language }: { game: GamePayload; language: Language }) {
  const content = useMemo(() => {
    if (game.kind === 'roll') {
      if (typeof game.value === 'number') {
        return (
          <div className="game-line">
            <span className="game-line-visual"><CrystalDie value={game.value} delayMs={0} /></span>
            <span className="game-line-text game-delayed">
              <span className="game-line-result">{game.value}</span>
              <span className="game-line-sub">{game.min}–{game.max}</span>
            </span>
          </div>
        );
      }
      const rolls = game.rolls ?? [];
      const cube = game.sides === 6;
      return (
        <div className="game-line">
          <span className="game-line-visual">
            {cube
              ? rolls.map((roll, index) => <Die3D key={index} value={roll} delayMs={index * 160} />)
              : rolls.map((roll, index) => <CrystalDie key={index} value={roll} delayMs={index * 140} />)}
          </span>
          <span className="game-line-text game-delayed">
            <span className="game-line-result">
              {rolls.length > 1 ? `${t(language, 'gameTotal')}: ${game.total}` : rolls[0]}
            </span>
            <span className="game-line-sub">{rolls.length}d{game.sides}</span>
          </span>
        </div>
      );
    }
    if (game.kind === 'coin') {
      return (
        <div className="game-line">
          <span className="game-line-visual">
            {game.flips.map((flip, index) => <Coin3D key={index} result={flip} delayMs={index * 220} />)}
          </span>
          <span className="game-line-text game-delayed game-delayed-coin">
            <span className="game-line-result">
              {game.flips.map((flip) => t(language, flip === 'heads' ? 'coinHeads' : 'coinTails')).join(' · ')}
            </span>
          </span>
        </div>
      );
    }
    if (game.kind === '8ball') {
      const answers = EIGHT_BALL[language] ?? EIGHT_BALL.en;
      return (
        <div className="game-line">
          <span className="game-line-visual"><EightBall /></span>
          <span className="game-line-text game-delayed">
            <span className="game-line-result">{answers[game.answer % answers.length]}</span>
            <span className="game-line-sub game-line-question">{game.q}</span>
          </span>
        </div>
      );
    }
    if (typeof game.member === 'string') {
      return (
        <div className="game-line">
          <span className="game-line-visual"><PickTarget /></span>
          <span className="game-line-text game-delayed">
            <span className="game-line-result">{game.member}</span>
            <span className="game-line-sub">{t(language, 'gamePickOf', { count: String(game.count ?? 0) })}</span>
          </span>
        </div>
      );
    }
    const options = game.options ?? [];
    return (
      <div className="game-line">
        <span className="game-line-visual"><PickTarget /></span>
        <span className="game-line-text game-delayed">
          <span className="game-line-result">{options[game.winner ?? 0]}</span>
          <span className="game-line-sub">{options.join(' · ')}</span>
        </span>
      </div>
    );
  }, [game, language]);

  return content;
}
