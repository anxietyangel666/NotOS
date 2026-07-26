import { normalizeNickname } from '../../db/users.js';

type MentionCandidate = {
  id: string;
  nickname: string;
};

const MENTION_RE = /(?:^|[\s([{<])@([\p{L}\p{N}_.-]{1,50})/gu;

export function mentionToken(value: string) {
  return normalizeNickname(value).replace(/\s+/g, '_');
}

export function extractMentionTokens(body: string) {
  const tokens = new Set<string>();
  MENTION_RE.lastIndex = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    tokens.add(mentionToken(match[1]));
  }
  return tokens;
}

export function mentionedUserIdsFromBody(body: string, users: MentionCandidate[], senderId: string) {
  const mentionedNames = extractMentionTokens(body);
  if (mentionedNames.size === 0) return [];
  return users
    .filter((user) => user.id !== senderId && mentionedNames.has(mentionToken(user.nickname)))
    .map((user) => user.id);
}
