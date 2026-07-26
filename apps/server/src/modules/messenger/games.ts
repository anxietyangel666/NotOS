// Chat mini-games (/roll, /coin, /8ball, /pick). The sender types a command as
// a normal message; the send route rewrites the body into a [game:...] marker
// with the server-generated result baked in, so outcomes cannot be faked or
// edited and the client renders the card with zero extra requests.
import { randomInt } from 'node:crypto';

export type GameResult =
  | { kind: 'roll'; payload: { rolls: number[]; sides: number; total: number } }
  | { kind: 'roll'; payload: { min: number; max: number; value: number } }
  | { kind: 'coin'; payload: { flips: Array<'heads' | 'tails'> } }
  | { kind: '8ball'; payload: { q: string; answer: number } }
  | { kind: 'pick'; payload: { options: string[]; winner: number } }
  | { kind: 'pick'; payload: { member: string; count: number } };

const EIGHT_BALL_ANSWERS = 20;
const MAX_DICE = 10;
const MAX_SIDES = 1000;
const MAX_RANGE_SPAN = 1_000_000_000;
const MAX_PICK_OPTIONS = 20;

function marker(result: GameResult): string {
  return `[game:${result.kind}:${Buffer.from(JSON.stringify(result.payload), 'utf8').toString('base64url')}]`;
}

// Returns the rewritten body when `body` is a recognized game command, or null
// to send the message untouched. `memberNames` powers "/pick @everyone" in
// group channels.
export function resolveGameCommand(body: string, memberNames?: string[]): string | null {
  const trimmed = body.trim();
  const match = /^\/(roll|coin|8ball|pick)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const args = (match[2] ?? '').trim();

  if (command === 'roll') {
    // "/roll 1-100" — a number in a range.
    const range = /^(\d{1,10})\s*-\s*(\d{1,10})$/.exec(args);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (min >= max || max - min > MAX_RANGE_SPAN) return null;
      return marker({ kind: 'roll', payload: { min, max, value: randomInt(min, max + 1) } });
    }
    // "/roll", "/roll d20", "/roll 2d6" — dice.
    const dice = /^(?:(\d{1,2})\s*)?d?\s*(\d{1,4})?$/i.exec(args);
    if (!dice) return null;
    const count = Math.min(Math.max(Number(dice[1] ?? 1) || 1, 1), MAX_DICE);
    const sides = Math.min(Math.max(Number(dice[2] ?? 6) || 6, 2), MAX_SIDES);
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    return marker({ kind: 'roll', payload: { rolls, sides, total: rolls.reduce((sum, value) => sum + value, 0) } });
  }

  if (command === 'coin') {
    const count = Math.min(Math.max(Number(args) || 1, 1), 10);
    const flips = Array.from({ length: count }, () => (randomInt(0, 2) === 0 ? 'heads' : 'tails') as 'heads' | 'tails');
    return marker({ kind: 'coin', payload: { flips } });
  }

  if (command === '8ball') {
    if (!args) return null;
    return marker({ kind: '8ball', payload: { q: args.slice(0, 200), answer: randomInt(0, EIGHT_BALL_ANSWERS) } });
  }

  // /pick @everyone → random channel member; /pick a | b | c → random option.
  if (args.toLowerCase() === '@everyone' && memberNames && memberNames.length > 0) {
    const member = memberNames[randomInt(0, memberNames.length)];
    return marker({ kind: 'pick', payload: { member: member.slice(0, 60), count: memberNames.length } });
  }
  const options = args
    .split('|')
    .map((option) => option.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, MAX_PICK_OPTIONS);
  if (options.length < 2) return null;
  return marker({ kind: 'pick', payload: { options, winner: randomInt(0, options.length) } });
}
