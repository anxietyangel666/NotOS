// Poll card rendered in place of a [poll:<id>] marker message. Fetches its
// own data, votes with one click and stays live through the
// messenger:pollUpdated socket event.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Language, PublicPoll } from '../api/types';
import { t } from '../i18n';
import { useSocket } from '../hooks/use-socket';

const POLL_MARKER_RE = /^\[poll:([0-9a-f-]{36})\]$/i;

export function extractPollId(body: string): string | null {
  return POLL_MARKER_RE.exec(body.trim())?.[1] ?? null;
}

export function PollEmbed({
  token,
  language,
  pollId,
  currentUserId
}: {
  token: string;
  language: Language;
  pollId: string;
  currentUserId: string;
}) {
  const socket = useSocket();
  const [poll, setPoll] = useState<PublicPoll | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getPoll(token, pollId)
      .then((payload) => { if (alive) setPoll(payload.poll); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [token, pollId]);

  useEffect(() => {
    if (!socket) return;
    function onPollUpdated(payload: { poll: PublicPoll }) {
      if (payload.poll.id === pollId) setPoll(payload.poll);
    }
    socket.on('messenger:pollUpdated', onPollUpdated);
    return () => { socket.off('messenger:pollUpdated', onPollUpdated); };
  }, [socket, pollId]);

  if (failed) return <div className="poll-embed poll-embed-error">{t(language, 'pollLoadFailed')}</div>;
  if (!poll) return <div className="poll-embed poll-embed-loading">📊 …</div>;

  const myIndexes = poll.options
    .map((option, index) => (option.voterIds.includes(currentUserId) ? index : -1))
    .filter((index) => index >= 0);

  function vote(index: number) {
    if (!poll || busy) return;
    const next = poll.multi
      ? (myIndexes.includes(index) ? myIndexes.filter((value) => value !== index) : [...myIndexes, index])
      : (myIndexes.includes(index) ? [] : [index]);
    setBusy(true);
    api.votePoll(token, poll.id, next)
      .then((payload) => setPoll(payload.poll))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }

  return (
    <div className="poll-embed">
      <div className="poll-embed-question">
        <span className="poll-embed-icon" aria-hidden="true">📊</span>
        <strong>{poll.question}</strong>
      </div>
      <div className="poll-embed-options">
        {poll.options.map((option, index) => {
          const votes = option.voterIds.length;
          const percent = poll.totalVoters > 0 ? Math.round((votes / poll.totalVoters) * 100) : 0;
          const mine = myIndexes.includes(index);
          return (
            <button
              key={index}
              type="button"
              className={mine ? 'poll-embed-option mine' : 'poll-embed-option'}
              disabled={busy}
              onClick={() => vote(index)}
            >
              <span className="poll-embed-bar" style={{ width: `${percent}%` }} aria-hidden="true" />
              <span className="poll-embed-option-text">{option.text}</span>
              <span className="poll-embed-option-stats">{percent}%</span>
            </button>
          );
        })}
      </div>
      <div className="poll-embed-footer">
        {poll.totalVoters} {t(language, 'pollVotes')}
        {poll.multi ? ` · ${t(language, 'pollMulti')}` : ''}
      </div>
    </div>
  );
}
