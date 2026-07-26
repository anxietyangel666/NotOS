/**
 * DesktopNotifications — memoized toast notification stack.
 *
 * Isolated from Desktop.tsx so that clock ticks, mouse moves and other
 * frequent state updates don't cause this list to re-render unnecessarily.
 */
import { memo, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

export type DesktopNotification = {
  id: string;
  title: string;
  message: string;
  avatarData?: string;
  onOpen?: () => void;
  // Inline quick reply straight from the toast (used by new-message toasts).
  onReply?: (text: string) => Promise<void>;
};

// "Reply" affordance inside a toast: a small button that expands into an
// input. `onHold` cancels the toast's auto-dismiss while the user types.
export function ToastQuickReply({
  language,
  onHold,
  onSend,
  onDone
}: {
  language: Language;
  onHold: () => void;
  onSend: (text: string) => Promise<void>;
  onDone: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        className="toast-reply-toggle"
        onClick={(event) => {
          event.stopPropagation();
          onHold();
          setExpanded(true);
        }}
      >
        {t(language, 'quickReply')}
      </button>
    );
  }

  return (
    <form
      className="toast-reply"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const body = text.trim();
        if (!body || sending) return;
        setSending(true);
        onSend(body)
          .then(onDone)
          .catch(() => setSending(false));
      }}
    >
      <input
        type="text"
        autoFocus
        value={text}
        placeholder={t(language, 'quickReplyPlaceholder')}
        onChange={(event) => setText(event.target.value)}
        onClick={(event) => event.stopPropagation()}
      />
      <button type="submit" disabled={!text.trim() || sending} aria-label={t(language, 'quickReply')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
      </button>
    </form>
  );
}

type Props = {
  language: Language;
  notifications: DesktopNotification[];
  onDismiss: (id: string) => void;
};

export const DesktopNotifications = memo(function DesktopNotifications({
  language,
  notifications,
  onDismiss
}: Props) {
  if (!notifications.length) return null;

  return (
    <div className="desktop-notifications" aria-live="polite">
      {notifications.map((notification) => (
        <article
          className={notification.onOpen ? 'desktop-toast clickable' : 'desktop-toast'}
          key={notification.id}
          role={notification.onOpen ? 'button' : undefined}
          tabIndex={notification.onOpen ? 0 : undefined}
          onClick={() => {
            notification.onOpen?.();
            onDismiss(notification.id);
          }}
          onKeyDown={(event) => {
            if (!notification.onOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
            if ((event.target as HTMLElement).closest('button')) return;
            event.preventDefault();
            notification.onOpen();
            onDismiss(notification.id);
          }}
        >
          {notification.avatarData
            ? <img src={notification.avatarData} alt="" />
            : <span className="desktop-toast-mark">M</span>}
          <div>
            <strong>{notification.title}</strong>
            <p>{notification.message}</p>
          </div>
          <button
            type="button"
            aria-label={t(language, 'close')}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss(notification.id);
            }}
          >
            x
          </button>
        </article>
      ))}
    </div>
  );
});
