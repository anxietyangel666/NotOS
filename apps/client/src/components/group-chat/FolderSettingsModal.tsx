// Folder rename modal (extracted from GroupChatView.tsx). The original inline
// JSX carried dead `channel`/`isVoice` branches that could never render for a
// folder target — they are dropped here; behavior is unchanged.
import type { Language } from '../../api/types';
import { t } from '../../i18n';
import { SaveBar } from '../SaveBar';

type FolderSettingsModalProps = {
  language: Language;
  editNameDraft: string;
  setEditNameDraft: (value: string) => void;
  editBarShake: number;
  isEditTargetDirty: () => boolean;
  requestCloseEditTarget: () => void;
  resetEditTarget: () => void;
  saveEditTarget: () => Promise<void>;
};

export function FolderSettingsModal({
  language,
  editNameDraft,
  setEditNameDraft,
  editBarShake,
  isEditTargetDirty,
  requestCloseEditTarget,
  resetEditTarget,
  saveEditTarget
}: FolderSettingsModalProps) {
  return (
    <div className="messenger-inline-modal" onClick={requestCloseEditTarget}>
      <div className="group-channel-modal has-save-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="group-settings-close" aria-label={t(language, 'close')} onClick={requestCloseEditTarget}>✕</button>
        <h3>{t(language, 'folderSettings')}</h3>
        <label>{t(language, 'renameFolder')}</label>
        <input type="text" className="messenger-input" value={editNameDraft}
          onChange={(e) => setEditNameDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveEditTarget(); }}
          autoFocus />
        <SaveBar
          language={language}
          dirty={isEditTargetDirty()}
          shakeKey={editBarShake}
          onReset={resetEditTarget}
          onSave={() => void saveEditTarget()}
        />
      </div>
    </div>
  );
}
