// Polls for DMs and group channels. The chat message only carries a
// [poll:<id>] marker; this module owns the poll rows, votes, access checks
// and the public shape sent to clients.
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../http/errors.js';

export type PollContext =
  | { type: 'dm'; a: string; b: string }
  | { type: 'group'; groupId: string; channelId: string };

export type PollRecord = {
  id: string;
  creator_id: string;
  question: string;
  options: string[];
  multi: boolean;
  context: PollContext;
  created_at: Date;
};

export type PublicPoll = {
  id: string;
  creatorId: string;
  question: string;
  multi: boolean;
  // Voter ids are public inside the conversation, so clients can highlight
  // their own choice and show who picked what.
  options: Array<{ text: string; voterIds: string[] }>;
  totalVoters: number;
  createdAt: string;
};

export function pollMarker(pollId: string) {
  return `[poll:${pollId}]`;
}

export async function createPoll(
  creatorId: string,
  question: string,
  options: string[],
  multi: boolean,
  context: PollContext
): Promise<PollRecord> {
  const result = await pool.query<PollRecord>(
    `
      INSERT INTO polls (id, creator_id, question, options, multi, context)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
      RETURNING *
    `,
    [randomUUID(), creatorId, question, JSON.stringify(options), multi, JSON.stringify(context)]
  );
  return result.rows[0];
}

export async function findPoll(pollId: string): Promise<PollRecord | null> {
  const result = await pool.query<PollRecord>('SELECT * FROM polls WHERE id = $1', [pollId]);
  return result.rows[0] ?? null;
}

export async function toPublicPoll(poll: PollRecord): Promise<PublicPoll> {
  const votes = await pool.query<{ option_index: number; user_id: string }>(
    'SELECT option_index, user_id FROM poll_votes WHERE poll_id = $1 ORDER BY created_at ASC',
    [poll.id]
  );
  const byOption = new Map<number, string[]>();
  const voters = new Set<string>();
  for (const vote of votes.rows) {
    let list = byOption.get(vote.option_index);
    if (!list) { list = []; byOption.set(vote.option_index, list); }
    list.push(vote.user_id);
    voters.add(vote.user_id);
  }
  return {
    id: poll.id,
    creatorId: poll.creator_id,
    question: poll.question,
    multi: poll.multi,
    options: poll.options.map((text, index) => ({ text, voterIds: byOption.get(index) ?? [] })),
    totalVoters: voters.size,
    createdAt: poll.created_at.toISOString()
  };
}

// Replaces the user's votes with the given option set (a single index unless
// the poll allows multiple answers). An empty list retracts the vote.
export async function setPollVotes(poll: PollRecord, userId: string, optionIndexes: number[]) {
  const unique = [...new Set(optionIndexes)];
  if (unique.some((index) => !Number.isInteger(index) || index < 0 || index >= poll.options.length)) {
    throw new HttpError(400, 'Unknown poll option', 'POLL_OPTION_INVALID');
  }
  if (!poll.multi && unique.length > 1) {
    throw new HttpError(400, 'This poll allows a single answer', 'POLL_SINGLE_CHOICE');
  }

  await pool.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [poll.id, userId]);
  for (const index of unique) {
    await pool.query(
      'INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [poll.id, userId, index]
    );
  }
}
