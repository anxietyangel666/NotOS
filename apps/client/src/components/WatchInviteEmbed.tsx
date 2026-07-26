import type { Language } from '../api/types';
import { t } from '../i18n';
import type { WatchInvite } from '../utils/watch-invite-link';

type WatchInviteEmbedProps = {
  language: Language;
  invite: WatchInvite;
  onOpen?: (inviteCode: string) => void;
};

export function WatchInviteEmbed({ language, invite, onOpen }: WatchInviteEmbedProps) {
  return (
    <div className="watch-invite-embed">
      <div className="watch-invite-icon" aria-hidden="true">
        <span />
      </div>
      <div className="watch-invite-body">
        <span className="watch-invite-eyebrow">{t(language, 'watchTogether')}</span>
        <strong className="watch-invite-name">{invite.title || t(language, 'watchRoomNamePlaceholder')}</strong>
      </div>
      <div className="watch-invite-actions">
        <button type="button" className="primary-action" onClick={() => onOpen?.(invite.code)}>
          {t(language, 'watchJoinRoom')}
        </button>
      </div>
    </div>
  );
}
