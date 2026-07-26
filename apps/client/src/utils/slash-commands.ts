// Discord-style slash commands expanded client-side at send time.
// `/shrug hello` -> `hello ¯\_(ツ)_/¯`, `/tableflip`, `/unflip`, `/spoiler`.
const KAOMOJI: Record<string, string> = {
  shrug: '¯\\_(ツ)_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
  unflip: '┬─┬ ノ( ゜-゜ノ)',
  lenny: '( ͡° ͜ʖ ͡°)'
};

export type SlashCommandInfo = {
  name: string;
  hint: string;
};

export const SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: 'roll', hint: '🎲 2d6 · d20 · 1-100' },
  { name: 'coin', hint: '🪙 heads / tails' },
  { name: 'pick', hint: '🎯 a | b | c · @everyone' },
  { name: '8ball', hint: '🎱 …?' },
  { name: 'shrug', hint: '¯\\_(ツ)_/¯' },
  { name: 'tableflip', hint: '(╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', hint: '┬─┬ ノ( ゜-゜ノ)' },
  { name: 'lenny', hint: '( ͡° ͜ʖ ͡°)' },
  { name: 'spoiler', hint: '||text||' }
];

// Expands a leading slash command in the outgoing body. Returns the body
// unchanged when it does not start with a known command.
export function applySlashCommand(body: string): string {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(body.trim());
  if (!match) return body;
  const command = match[1].toLowerCase();
  const rest = (match[2] ?? '').trim();

  const kaomoji = KAOMOJI[command];
  if (kaomoji) return rest ? `${rest} ${kaomoji}` : kaomoji;
  if (command === 'spoiler' && rest) return `||${rest}||`;
  return body;
}
