// Left sidebar of the group chat: channel/folder list with drag-and-drop,
// group header with the quick nameplate popup, and the message search panel.
// Extracted verbatim from GroupChatView.tsx — state and handlers still live in
// the parent and arrive via props.
import { Fragment, useState, type Dispatch, type DragEvent, type MutableRefObject, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { Group, GroupChannel, GroupFolder, GroupMessage, Language, NamePlate, PublicUser } from '../../api/types';
import { nameplateToCss } from '../../api/types';
import type { VoiceRoom } from '../../hooks/use-voice-room';
import { t } from '../../i18n';
import { formatMessageDate } from '../../utils/message-date';
import { CameraActiveIcon, DeafenedIcon, MicMuteIcon, ScreenShareIcon } from '../PlayerIcons';
import { UserName } from '../UserName';
import { isVideoCircleAttachment, isVoiceAttachment } from '../VoiceMessage';
import { UserVolumePopover } from '../UserVolumePopover';

type ChannelMenuState = { x: number; y: number; kind: 'channel' | 'folder'; id: string; name: string } | null;
type DeleteTargetState = { kind: 'channel' | 'folder'; id: string; name: string } | null;
type DraggedItemState = { type: 'channel' | 'folder'; id: string } | null;

type GroupChannelsPanelProps = {
  language: Language;
  currentUser: PublicUser;
  group: Group;
  channels: GroupChannel[];
  folders: GroupFolder[];
  activeChannel: string | null;
  voiceRoom?: VoiceRoom;
  groupSearchOpen: boolean;
  setGroupSearchOpen: (value: boolean) => void;
  groupSearchQuery: string;
  setGroupSearchQuery: (value: string) => void;
  groupSearchActiveId: string | null;
  setGroupSearchActiveId: (value: string | null) => void;
  groupSearchMatches: GroupMessage[];
  groupSearchInputRef: MutableRefObject<HTMLInputElement | null>;
  jumpToGroupSearchMatch: (direction?: number) => void;
  knownSenders: Map<string, PublicUser>;
  threadRef: MutableRefObject<HTMLDivElement | null>;
  nameplateDraft: NonNullable<NamePlate>;
  newAvatar: string | null;
  isOwner: boolean;
  saveNameplate: (plate: NonNullable<NamePlate>) => Promise<void>;
  handlePlateCropUpload: (file: File | undefined) => Promise<void>;
  platePopupOpen: boolean;
  setPlatePopupOpen: Dispatch<SetStateAction<boolean>>;
  platePopupPos: { left: number; top: number; width: number } | null;
  setPlatePopupPos: (value: { left: number; top: number; width: number } | null) => void;
  platePopupRef: MutableRefObject<HTMLDivElement | null>;
  setGroupMenuOpen: (value: boolean) => void;
  canManageChannels: boolean;
  isGroupAdmin: boolean;
  setCreateChannelType: (value: 'text' | 'voice' | 'feed') => void;
  setShowCreateChannel: (value: boolean) => void;
  setShowCreateFolder: (value: boolean) => void;
  setShowSettings: (value: boolean) => void;
  setCustomizeOpen: (value: boolean) => void;
  handleCopyInvite: () => Promise<void>;
  collapsedFolders: Set<string>;
  toggleFolderCollapsed: (folderId: string) => void;
  draggedItem: DraggedItemState;
  handleChannelDragStart: (e: DragEvent, channelId: string) => void;
  handleFolderDragStart: (e: DragEvent, folderId: string) => void;
  handleDragOver: (e: DragEvent) => void;
  handleDropOnChannel: (e: DragEvent, targetChannelId: string, targetFolderId: string | null) => void;
  handleDropOnFolder: (e: DragEvent, targetFolderId: string) => void;
  handleDropOnRoot: (e: DragEvent) => void;
  handleDragEnd: () => void;
  setChannelMenu: (value: ChannelMenuState) => void;
  setDeleteTarget: (value: DeleteTargetState) => void;
  handleVoiceChannelClick: (channelId: string) => void;
  openTextChannel: (channelId: string) => void;
  openChannelSettings: (channelId: string) => void;
  isFeedInternalChannel: (channel: GroupChannel | undefined | null) => boolean;
  isFeedManagedChannel: (channel: GroupChannel | undefined | null) => boolean;
  setVoiceStageOpen: (value: boolean) => void;
};

export function GroupChannelsPanel({
  language,
  currentUser,
  group,
  channels,
  folders,
  activeChannel,
  voiceRoom,
  groupSearchOpen,
  setGroupSearchOpen,
  groupSearchQuery,
  setGroupSearchQuery,
  groupSearchActiveId,
  setGroupSearchActiveId,
  groupSearchMatches,
  groupSearchInputRef,
  jumpToGroupSearchMatch,
  knownSenders,
  threadRef,
  nameplateDraft,
  newAvatar,
  isOwner,
  saveNameplate,
  handlePlateCropUpload,
  platePopupOpen,
  setPlatePopupOpen,
  platePopupPos,
  setPlatePopupPos,
  platePopupRef,
  setGroupMenuOpen,
  canManageChannels,
  isGroupAdmin,
  setCreateChannelType,
  setShowCreateChannel,
  setShowCreateFolder,
  setShowSettings,
  setCustomizeOpen,
  handleCopyInvite,
  collapsedFolders,
  toggleFolderCollapsed,
  draggedItem,
  handleChannelDragStart,
  handleFolderDragStart,
  handleDragOver,
  handleDropOnChannel,
  handleDropOnFolder,
  handleDropOnRoot,
  handleDragEnd,
  setChannelMenu,
  setDeleteTarget,
  handleVoiceChannelClick,
  openTextChannel,
  openChannelSettings,
  isFeedInternalChannel,
  isFeedManagedChannel,
  setVoiceStageOpen
}: GroupChannelsPanelProps) {
  function renderChannelButton(channel: GroupChannel, folderId: string | null) {
    const isVoice = channel.type === 'voice';
    const isFeed = channel.type === 'feed';
    const inThisVoice = isVoice && voiceRoom?.activeChannelId === channel.id;
    const voiceParticipants = isVoice ? (voiceRoom?.channelParticipants.get(channel.id) ?? []) : [];
    if (isVoice && channel.settings?.hideInactive && voiceParticipants.length === 0 && !inThisVoice && !canManageChannels) {
      return null;
    }
    const isActive = isVoice ? inThisVoice : activeChannel === channel.id;
    return (
      <button key={channel.id}
        className={`group-channel ${isVoice ? 'voice-channel' : ''} ${isFeed ? 'feed-channel' : ''} ${isActive ? 'active' : ''} ${draggedItem?.type === 'channel' && draggedItem.id !== channel.id ? 'drag-over' : ''}`}
        type="button"
        draggable={canManageChannels && !isFeedInternalChannel(channel)}
        onDragStart={(e) => handleChannelDragStart(e, channel.id)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDropOnChannel(e, channel.id, folderId)}
        onDragEnd={handleDragEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setChannelMenu({ x: event.clientX, y: event.clientY, kind: 'channel', id: channel.id, name: channel.name });
        }}
        onClick={() => isVoice ? handleVoiceChannelClick(channel.id) : openTextChannel(channel.id)}>
        <span className="group-channel-hash">
          {isVoice
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-9v2a7 7 0 0 1 0 14v2a9 9 0 0 0 0-18z"/></svg>
            : isFeed
              ? <span className="group-channel-feed-icon" aria-hidden="true" />
              : <span className="group-channel-hashtag-icon" aria-hidden="true" />}
        </span>
        <span className="group-channel-name">{channel.name}</span>
        {isVoice && channel.userLimit != null ? (
          <span className="group-channel-count">{voiceParticipants.length}/{channel.userLimit}</span>
        ) : null}
        {canManageChannels ? (
          <span className="group-channel-gear" title={t(language, 'channelSettings')}
            onClick={(e) => { e.stopPropagation(); openChannelSettings(channel.id); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
        ) : null}
        {channel.name !== 'general' && !isFeedManagedChannel(channel) ? (
          <span className="group-channel-delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'channel', id: channel.id, name: channel.name }); }}>✕</span>
        ) : null}
      </button>
    );
  }

  const [volumeMenu, setVolumeMenu] = useState<{ user: PublicUser; anchor: { x: number; y: number } } | null>(null);

  // Bottom participant list for a voice channel (shown under it when occupied).
  function renderVoiceParticipants(channelId: string) {
    const list = voiceRoom?.channelParticipants.get(channelId) ?? [];
    if (list.length === 0) return null;
    return (
      <div className="voice-participants">
        {list.map((p) => (
          <div key={p.userId} className={`voice-participant ${voiceRoom?.talkingIds.has(p.userId) ? 'talking' : ''}`}
            title={p.user.nickname}
            onClick={() => { if (voiceRoom?.activeChannelId === channelId) setVoiceStageOpen(true); }}
            onContextMenu={(e) => {
              if (p.userId !== currentUser.id) {
                e.preventDefault();
                e.stopPropagation();
                setVolumeMenu({ user: p.user, anchor: { x: e.clientX, y: e.clientY } });
              }
            }}>
            <img src={p.user.avatarData} alt="" />
            <span className="voice-participant-name"><UserName user={p.user} /></span>
            {p.deafened ? (
              <span className="voice-participant-deafened" title={t(language, 'deafen')}>
                <DeafenedIcon size={14} />
              </span>
            ) : p.muted ? (
              <span className="voice-participant-muted" title={t(language, 'mute')}>
                <MicMuteIcon size={14} />
              </span>
            ) : null}
            {p.camera ? (
              <span className="voice-participant-camera" title={t(language, 'cameraActive')}>
                <CameraActiveIcon size={14} />
              </span>
            ) : null}
            {p.screen ? (
              <span className="voice-participant-screen" title={t(language, 'shareScreen')}>
                <ScreenShareIcon size={14} />
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside className={groupSearchOpen ? 'group-channels-panel messenger-search-panel group-channel-search-panel' : 'group-channels-panel'}>
      {groupSearchOpen ? (
        <>
          <div className="messenger-search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            <input
              ref={groupSearchInputRef}
              autoFocus
              type="text"
              value={groupSearchQuery}
              placeholder={t(language, 'search')}
              onChange={(event) => {
                setGroupSearchQuery(event.target.value);
                setGroupSearchActiveId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setGroupSearchOpen(false);
                  setGroupSearchQuery('');
                  setGroupSearchActiveId(null);
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  jumpToGroupSearchMatch(event.shiftKey ? -1 : 1);
                }
              }}
            />
            {groupSearchQuery ? (
              <button type="button" className="messenger-search-clear" onClick={() => { setGroupSearchQuery(''); setGroupSearchActiveId(null); }} aria-label="clear">×</button>
            ) : null}
          </div>
          <div className="messenger-search-results">
            {groupSearchQuery.trim() && groupSearchMatches.length === 0 ? (
              <div className="explorer-empty">{t(language, 'noMessages')}</div>
            ) : null}
            {groupSearchMatches.map((result) => {
              const sender = knownSenders.get(result.senderId) ?? currentUser;
              return (
                <button
                  key={result.id}
                  type="button"
                  className={groupSearchActiveId === result.id ? 'messenger-search-result active' : 'messenger-search-result'}
                  onClick={() => {
                    setGroupSearchActiveId(result.id);
                    const el = document.getElementById('gmsg-' + result.id);
                    if (el && threadRef.current) {
                      const tNode = threadRef.current;
                      const tRect = tNode.getBoundingClientRect();
                      const elRect = el.getBoundingClientRect();
                      tNode.scrollBy({ top: elRect.top - tRect.top - 96, behavior: 'smooth' });
                      el.classList.add('message-jump-highlight');
                      window.setTimeout(() => el.classList.remove('message-jump-highlight'), 1200);
                    }
                  }}
                >
                  <span className="messenger-avatar-wrap">
                    <img src={sender.avatarData} alt="" draggable={false} />
                  </span>
                  <span className="messenger-search-result-text">
                    <span className="messenger-search-result-head">
                      <strong>{sender.nickname}</strong>
                      <small>{formatMessageDate(result.createdAt, language)}</small>
                    </span>
                    <span>{result.body || (isVoiceAttachment(result.imageData, result.imageName) ? '🎤' : isVideoCircleAttachment(result.imageData, result.imageName) ? '📹' : result.imageData ? '📷' : '')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
      <>
      <div
        className={`group-channels-header${nameplateToCss(nameplateDraft) ? ' has-nameplate' : ''}`}
        style={nameplateToCss(nameplateDraft) ? { background: nameplateToCss(nameplateDraft)!, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <button type="button" className="group-name-btn" onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const header = (e.currentTarget.closest('.group-channels-header') as HTMLElement) ?? e.currentTarget;
          const rect = header.getBoundingClientRect();
          setPlatePopupPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
          setPlatePopupOpen((v) => !v);
          setGroupMenuOpen(false);
        }}>
          <strong>{group.name}</strong>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {platePopupOpen ? createPortal(
          <div
            ref={platePopupRef}
            className="nameplate-quick-popup"
            style={{ left: platePopupPos?.left ?? 0, top: platePopupPos?.top ?? 0, minWidth: Math.max(240, platePopupPos?.width ?? 0) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Live preview of the current nameplate. */}
            <div
              className="nameplate-quick-preview"
              style={nameplateToCss(nameplateDraft) ? { background: nameplateToCss(nameplateDraft)!, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              <img src={newAvatar ?? group.avatarData} alt="" />
              <strong>{group.name}</strong>
            </div>

            {isOwner ? (
              <>
                <div className="nameplate-types">
                  {(['none', 'color', 'gradient', 'image'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={nameplateDraft.type === type ? 'nameplate-type active' : 'nameplate-type'}
                      onClick={() => void saveNameplate({ ...nameplateDraft, type })}
                    >
                      {t(language, type === 'none' ? 'nameplateNone' : type === 'color' ? 'nameplateColor' : type === 'gradient' ? 'nameplateGradient' : 'nameplateImage')}
                    </button>
                  ))}
                </div>

                {nameplateDraft.type === 'color' ? (
                  <label className="nameplate-field">
                    <span>{t(language, 'nameplateColor')}</span>
                    <input type="color" value={nameplateDraft.color} onChange={(e) => void saveNameplate({ ...nameplateDraft, color: e.target.value })} />
                  </label>
                ) : null}

                {nameplateDraft.type === 'gradient' ? (
                  <div className="nameplate-gradient-row">
                    <label className="nameplate-field">
                      <span>{t(language, 'nameplateFrom')}</span>
                      <input type="color" value={nameplateDraft.gradientFrom} onChange={(e) => void saveNameplate({ ...nameplateDraft, gradientFrom: e.target.value })} />
                    </label>
                    <label className="nameplate-field">
                      <span>{t(language, 'nameplateTo')}</span>
                      <input type="color" value={nameplateDraft.gradientTo} onChange={(e) => void saveNameplate({ ...nameplateDraft, gradientTo: e.target.value })} />
                    </label>
                  </div>
                ) : null}

                {nameplateDraft.type === 'image' ? (
                  <div className="nameplate-quick-actions">
                    <label className="secondary-action" style={{ textAlign: 'center', cursor: 'pointer' }}>
                      {t(language, 'nameplateUpload')}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { void handlePlateCropUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
                      />
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="nameplate-quick-menu">
              {canManageChannels ? (
                <>
                  <button type="button" onClick={() => { setCreateChannelType('text'); setShowCreateChannel(true); setPlatePopupOpen(false); }}>{t(language, 'createChannel')}</button>
                  <button type="button" onClick={() => { setCreateChannelType('voice'); setShowCreateChannel(true); setPlatePopupOpen(false); }}>{t(language, 'createVoiceChannel')}</button>
                  <button type="button" onClick={() => { setCreateChannelType('feed'); setShowCreateChannel(true); setPlatePopupOpen(false); }}>{t(language, 'createFeed')}</button>
                  <button type="button" onClick={() => { setShowCreateFolder(true); setPlatePopupOpen(false); }}>{t(language, 'createFolder')}</button>
                </>
              ) : null}
              {isGroupAdmin ? (
                <button type="button" onClick={() => { setShowSettings(true); setPlatePopupOpen(false); }}>{t(language, 'groupSettings')}</button>
              ) : (
                <button type="button" onClick={() => { void handleCopyInvite(); setPlatePopupOpen(false); }}>{t(language, 'copyInviteLink')}</button>
              )}
            </div>
          </div>,
          document.body
        ) : null}
      </div>
      <button type="button" className="group-customize-btn" onClick={() => setCustomizeOpen(true)}>
        {t(language, 'customizeProfile')}
      </button>
      <hr className="group-customize-divider" />
      <div className="group-channels-list">
        {folders.map((folder) => {
          const collapsed = collapsedFolders.has(folder.id);
          const folderChannels = channels.filter((c) => c.folderId === folder.id);
          return (
            <div key={folder.id}
              className={`group-folder ${draggedItem?.type === 'folder' && draggedItem.id !== folder.id ? 'drag-over' : ''}`}
              draggable={canManageChannels}
              onDragStart={(e) => handleFolderDragStart(e, folder.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnFolder(e, folder.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setChannelMenu({ x: event.clientX, y: event.clientY, kind: 'folder', id: folder.id, name: folder.name });
              }}
              onDragEnd={handleDragEnd}>
              <button type="button" className="group-folder-header" onClick={() => toggleFolderCollapsed(folder.id)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span>{folder.name}</span>
                {canManageChannels ? (
                  <span className="group-channel-delete" title={t(language, 'deleteFolder')} onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'folder', id: folder.id, name: folder.name }); }}>✕</span>
                ) : null}
              </button>
              {!collapsed ? (
                <div className="group-folder-channels" onDragOver={handleDragOver} onDrop={(e) => handleDropOnFolder(e, folder.id)}>
                  {folderChannels.map((channel) => (
                    <Fragment key={channel.id}>
                      {renderChannelButton(channel, folder.id)}
                      {channel.type === 'voice' ? renderVoiceParticipants(channel.id) : null}
                    </Fragment>
                  ))}
                  {folderChannels.length === 0 ? (
                    <div className="group-folder-empty">{t(language, 'dropChannelHere')}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {/* Root drop zone fills the remaining space so channels can be dragged out of folders. */}
        <div
          className={`group-channels-root ${draggedItem?.type === 'channel' ? 'droppable' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDropOnRoot}>
          {channels.filter((c) => !c.folderId).map((channel) => (
            <Fragment key={channel.id}>
              {renderChannelButton(channel, null)}
              {channel.type === 'voice' ? renderVoiceParticipants(channel.id) : null}
            </Fragment>
          ))}
        </div>
      </div>
      </>
      )}

      {volumeMenu ? (
        <UserVolumePopover
          user={volumeMenu.user}
          anchor={volumeMenu.anchor}
          language={language}
          onClose={() => setVolumeMenu(null)}
        />
      ) : null}
    </aside>
  );
}
