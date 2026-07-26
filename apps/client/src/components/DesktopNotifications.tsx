/**
 * DesktopNotifications — memoized toast notification stack.
 *
 * Isolated from Desktop.tsx so that clock ticks, mouse moves and other
 * frequent state updates don't cause this list to re-render unnecessarily.
 */
import { memo } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

export type DesktopNotification = {
  id: string;
  title: string;
  message: string;
  avatarData?: string;
  onOpen?: () => void;
};

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
