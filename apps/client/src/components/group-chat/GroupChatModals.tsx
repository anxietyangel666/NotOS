// Small self-contained modals for the group chat: create channel/folder and
// the delete confirmations. Extracted verbatim from GroupChatView.tsx.
import type { GroupMessage, Language } from '../../api/types';
import { t } from '../../i18n';

export function CreateChannelModal({
  language,
  createChannelType,
  newChannelName,
  setNewChannelName,
  handleCreateChannel,
  onClose
}: {
  language: Language;
  createChannelType: 'text' | 'voice' | 'feed';
  newChannelName: string;
  setNewChannelName: (value: string) => void;
  handleCreateChannel: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="messenger-inline-modal" onClick={onClose}>
      <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t(language, createChannelType === 'feed' ? 'createFeed' : createChannelType === 'voice' ? 'createVoiceChannel' : 'createChannel')}</h3>
        <label>{t(language, 'channelName')}</label>
        <input type="text" className="messenger-input" value={newChannelName}
          onChange={(e) => setNewChannelName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateChannel(); }}
          placeholder="general"
          autoFocus />
        <div className="group-channel-modal-actions">
          <button type="button" className="primary-action" disabled={!newChannelName.trim()} onClick={() => void handleCreateChannel()}>{t(language, 'create')}</button>
          <button type="button" className="secondary-action" onClick={onClose}>{t(language, 'close')}</button>
        </div>
      </div>
    </div>
  );
}

export function CreateFolderModal({
  language,
  newFolderName,
  setNewFolderName,
  handleCreateFolder,
  onClose
}: {
  language: Language;
  newFolderName: string;
  setNewFolderName: (value: string) => void;
  handleCreateFolder: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="messenger-inline-modal" onClick={onClose}>
      <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t(language, 'createFolder')}</h3>
        <label>{t(language, 'folderName')}</label>
        <input type="text" className="messenger-input" value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); }}
          placeholder="folder name"
          autoFocus />
        <div className="group-channel-modal-actions">
          <button type="button" className="primary-action" disabled={!newFolderName.trim()} onClick={() => void handleCreateFolder()}>{t(language, 'create')}</button>
          <button type="button" className="secondary-action" onClick={onClose}>{t(language, 'close')}</button>
        </div>
      </div>
    </div>
  );
}

export function DeleteChannelOrFolderModal({
  language,
  deleteTarget,
  handleDeleteChannel,
  handleDeleteFolder,
  onClose
}: {
  language: Language;
  deleteTarget: { kind: 'channel' | 'folder'; id: string; name: string };
  handleDeleteChannel: (channelId: string) => Promise<void>;
  handleDeleteFolder: (folderId: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="messenger-inline-modal" onClick={onClose}>
      <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t(language, deleteTarget.kind === 'folder' ? 'deleteFolder' : 'deleteChannel')}</h3>
        <p className="confirm-text">{t(language, deleteTarget.kind === 'folder' ? 'deleteFolderConfirm' : 'deleteChannelConfirm', { name: deleteTarget.name })}</p>
        <div className="group-channel-modal-actions">
          <button type="button" className="danger-action" onClick={() => {
            if (deleteTarget.kind === 'channel') void handleDeleteChannel(deleteTarget.id);
            else void handleDeleteFolder(deleteTarget.id);
            onClose();
          }}>{t(language, 'delete')}</button>
          <button type="button" className="secondary-action" onClick={onClose}>{t(language, 'cancel')}</button>
        </div>
      </div>
    </div>
  );
}

export function DeleteMessageConfirmModal({
  language,
  message,
  deleteMessage,
  onClose
}: {
  language: Language;
  message: GroupMessage;
  deleteMessage: (message: GroupMessage) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="messenger-inline-modal" onClick={onClose}>
      <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <p>{t(language, 'confirmDelete')}</p>
        <div className="confirm-actions">
          <button type="button" className="primary-action danger-text" onClick={() => { void deleteMessage(message); onClose(); }}>
            {t(language, 'deleteMessage')}
          </button>
          <button type="button" className="secondary-action" onClick={onClose}>
            {t(language, 'cancel')}
          </button>
        </div>
      </section>
    </div>
  );
}
