import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser, VoiceChatMessage } from '../api/types';
import type { VoiceRoom } from '../hooks/use-voice-room';
import { t, getSavedTimeFormat, LOCALES } from '../i18n';
import { MessageBody } from './Twemoji';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { EmojiToggleIcon, GifIcon } from './ChatComposeIcons';
import { useAvatarColor } from './CallOverlay';
import { UserName } from './UserName';
import { EmojiPicker } from './EmojiPicker';
import { expandCustomEmojiShortcodes } from '../utils/custom-emoji';
import type { TenorGif } from '../utils/tenor';

// A single screen-share tile in the Discord-style voice grid.
function ScreenTile({ stream, label, focused, onFocus, onFullscreen }: { stream: MediaStream; label: string; focused: boolean; onFocus: () => void; onFullscreen: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    const tryPlay = () => { void video.play().catch(() => undefined); };
    tryPlay();
    video.onloadedmetadata = tryPlay;
    const onTrackChange = () => tryPlay();
    stream.addEventListener('addtrack', onTrackChange);
    return () => { stream.removeEventListener('addtrack', onTrackChange); };
  }, [stream]);
  return (
    <button type="button" className={`dvoice-tile dvoice-tile-screen${focused ? ' focused' : ''}`} onClick={onFocus} onDoubleClick={onFullscreen} title={label}>
      <video ref={ref} autoPlay playsInline muted />
      <span className="dvoice-tile-name">{label}</span>
      <span className="dvoice-tile-live">LIVE</span>
    </button>
  );
}

// A single participant tile in the Discord-style voice grid: a dark rounded card
// with the avatar centered, the name pinned bottom-left, and a mute badge.
function PersonTile({ user, talking, muted, focused, onFocus }: { user: PublicUser; talking?: boolean; muted?: boolean; focused: boolean; onFocus: () => void }) {
  const color = useAvatarColor(user.avatarData);
  return (
    <button
      type="button"
      className={`dvoice-tile dvoice-tile-person${talking ? ' talking' : ''}${focused ? ' focused' : ''}`}
      style={{ '--tile-tint': color } as CSSProperties}
      onClick={onFocus}
      title={user.nickname}
    >
      <span className="dvoice-tile-avatar">
        <img src={user.avatarData} alt="" />
      </span>
      <span className="dvoice-tile-name">
        {muted ? (
          <svg className="dvoice-tile-mute" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>
        ) : null}
        <UserName user={user} />
      </span>
    </button>
  );
}

type VoiceStageProps = {
  language: Language;
  currentUser: PublicUser;
  channelName: string;
  voiceRoom: VoiceRoom;
  token?: string;
};

// Discord-style voice channel view. The stage shows a responsive grid of
// participant/screen-share tiles (exactly like Discord's call grid). A floating
// control pill sits at the bottom-center. The ephemeral voice chat lives in a
// collapsible side panel on the right, matching Discord's layout.
export function VoiceStage({ language, currentUser, channelName, voiceRoom, token }: VoiceStageProps) {
  const [draft, setDraft] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const [chatOpen, setChatOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // Right-click menu (edit/delete) for one of the user's own voice-chat messages.
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: VoiceChatMessage } | null>(null);
  // The message currently being edited inline, plus the working draft text.
  const [editingMessage, setEditingMessage] = useState<VoiceChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<EmojiInlineInputHandle | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [voiceRoom.chat.length]);

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Dismiss the message context menu on any outside click or Escape.
  useEffect(() => {
    if (!messageMenu) return;
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.context-menu')) return;
      setMessageMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMessageMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [messageMenu]);

  function formatTime(value: string) {
    return new Intl.DateTimeFormat(LOCALES[language], {
      hour: '2-digit', minute: '2-digit', hour12: getSavedTimeFormat() === '12h'
    }).format(new Date(value));
  }

  function beginEdit(message: VoiceChatMessage) {
    setEditingMessage(message);
    setEditDraft(message.body);
    setMessageMenu(null);
  }

  function saveEdit() {
    if (!editingMessage) return;
    const body = expandCustomEmojiShortcodes(editDraft.trim());
    if (body && body !== editingMessage.body) voiceRoom.editChat(editingMessage.id, body);
    setEditingMessage(null);
    setEditDraft('');
  }

  function cancelEdit() {
    setEditingMessage(null);
    setEditDraft('');
  }

  function send() {
    const body = expandCustomEmojiShortcodes(draft.trim());
    if (!body) return;
    voiceRoom.sendChat(body);
    setDraft('');
  }

  function insertEmoji(emoji: string) {
    inputRef.current?.insertText(emoji);
  }

  // Voice chat has no image payload, so a chosen GIF is sent as its URL which
  // renders as a link/inline media in the chat list.
  function sendGif(gif: TenorGif) {
    voiceRoom.sendChat(gif.url);
    setEmojiOpen(false);
  }

  // Build every tile: participants first, then screen shares.
  type Tile =
    | { id: string; kind: 'person'; user: PublicUser; talking: boolean; muted: boolean }
    | { id: string; kind: 'screen'; stream: MediaStream; label: string };
  const tiles = useMemo<Tile[]>(() => {
    const list: Tile[] = voiceRoom.participants.map((p) => ({
      id: `person:${p.userId}`,
      kind: 'person',
      user: p.user,
      talking: voiceRoom.talkingIds.has(p.userId),
      muted: Boolean(p.muted)
    }));
    voiceRoom.remoteVideo.forEach((stream, userId) => {
      const p = voiceRoom.participants.find((x) => x.userId === userId);
      list.push({ id: `screen:${userId}`, kind: 'screen', stream, label: p?.user.nickname ?? '' });
    });
    if (voiceRoom.localScreenStream) {
      list.push({ id: 'screen:local', kind: 'screen', stream: voiceRoom.localScreenStream, label: currentUser.nickname });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRoom.participants, voiceRoom.remoteVideo, voiceRoom.localScreenStream, voiceRoom.talkingIds, currentUser.nickname]);

  // When a screen share appears, focus it (Discord spotlights an active share).
  const firstScreen = tiles.find((tile) => tile.kind === 'screen');
  useEffect(() => {
    if (firstScreen) setFocusId(firstScreen.id);
    else setFocusId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstScreen?.id]);

  // When a tile is focused, it becomes the large spotlight and the rest sit in a
  // thumbnail row below it (Discord's "focused" layout). With no focus, all tiles
  // share an even responsive grid.
  const focused = focusId ? tiles.find((tile) => tile.id === focusId) ?? null : null;
  const gridTiles = focused ? tiles.filter((tile) => tile.id !== focused.id) : tiles;
  const tileCount = focused ? 1 : tiles.length;
  // Discord caps the columns so tiles stay large; pick columns from the count.
  const columns = tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 9 ? 3 : 4;

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (stageRef.current) {
      void stageRef.current.requestFullscreen().catch(() => undefined);
    }
  }

  function renderTile(tile: Tile) {
    if (tile.kind === 'person') {
      return (
        <PersonTile key={tile.id} user={tile.user} talking={tile.talking} muted={tile.muted}
          focused={focused?.id === tile.id} onFocus={() => setFocusId((id) => (id === tile.id ? null : tile.id))} />
      );
    }
    return (
      <ScreenTile key={tile.id} stream={tile.stream} label={`${tile.label} · ${t(language, 'screenSharing')}`}
        focused={focused?.id === tile.id} onFocus={() => setFocusId((id) => (id === tile.id ? null : tile.id))} onFullscreen={toggleFullscreen} />
    );
  }

  return (
    <div ref={stageRef} className={`dvoice${chatOpen ? ' chat-open' : ''}${fullscreen ? ' group-fullscreen' : ''}`}>
      {/* Voice stage: header + tile grid + floating controls. */}
      <div className="dvoice-stage">
        <div className="dvoice-grid-wrap">
          {focused ? (
            <div className="dvoice-spotlight">
              <div className="dvoice-spotlight-main">{renderTile(focused)}</div>
              {gridTiles.length > 0 ? (
                <div className="dvoice-spotlight-strip">{gridTiles.map(renderTile)}</div>
              ) : null}
            </div>
          ) : (
            <div className="dvoice-grid" style={{ '--cols': columns } as CSSProperties}>
              {gridTiles.map(renderTile)}
            </div>
          )}
        </div>

        {/* Floating Discord-style control pill. */}
        <div className="dvoice-controls">
          <button className={`dvoice-ctrl${voiceRoom.muted ? ' danger-active' : ''}`} type="button" onClick={() => voiceRoom.toggleMute()} title={voiceRoom.muted ? t(language, 'unmute') : t(language, 'mute')}>
            {voiceRoom.muted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
            )}
          </button>
          <button className={`dvoice-ctrl${voiceRoom.deafened ? ' danger-active' : ''}`} type="button" onClick={() => voiceRoom.toggleDeafen()} title={voiceRoom.deafened ? t(language, 'undeafen') : t(language, 'deafen')}>
            {voiceRoom.deafened ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M2.7 3.7 1.3 5.1 4.4 8.2A9 9 0 0 0 3 13v4a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 .9-3.4l13 13 1.4-1.4L2.7 3.7zM12 4a9 9 0 0 1 9 9v4a3 3 0 0 1-1.6 2.6L17 17.2V13h2a7 7 0 0 0-9.3-6.6L8.1 4.8A9 9 0 0 1 12 4z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 14 0v1h-2v7h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9z"/></svg>
            )}
          </button>
          <button className={`dvoice-ctrl${voiceRoom.sharingScreen ? ' active' : ''}`} type="button" onClick={() => void voiceRoom.requestScreenShare()} title={voiceRoom.sharingScreen ? t(language, 'stopScreenShare') : t(language, 'shareScreen')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 12H4V6h16v10z"/></svg>
          </button>
          {firstScreen ? (
            <button className={`dvoice-ctrl${fullscreen ? ' active' : ''}`} type="button" onClick={toggleFullscreen} title={fullscreen ? t(language, 'callExitFullscreen') : t(language, 'callFullscreen')}>
              {fullscreen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
              )}
            </button>
          ) : null}
          <button className={`dvoice-ctrl${chatOpen ? ' active' : ''}`} type="button" onClick={() => setChatOpen((v) => !v)} title={t(language, 'voiceChat')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-4H6V6h12v1z"/></svg>
          </button>
          <button className="dvoice-ctrl hangup" type="button" onClick={() => voiceRoom.leave()} title={t(language, 'leaveVoice')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
          </button>
        </div>
      </div>

      {/* Ephemeral voice chat side panel (Discord-style). */}
      {chatOpen ? (
        <div className="dvoice-chat">
          <div ref={threadRef} className="dvoice-chat-thread">
            {voiceRoom.chat.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
            {voiceRoom.chat.map((m) => {
              const own = m.senderId === currentUser.id;
              const editing = editingMessage?.id === m.id;
              return (
                <div
                  key={m.id}
                  className="dvoice-chat-msg"
                  onContextMenu={own ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMessageMenu({
                      x: Math.min(event.clientX, window.innerWidth - 170),
                      y: Math.min(event.clientY, window.innerHeight - 90),
                      message: m
                    });
                  } : undefined}
                >
                  <img src={m.senderAvatar} alt="" />
                  <div>
                    <strong>
                      {m.senderNickname}
                      <span className="dvoice-chat-time">{formatTime(m.createdAt)}</span>
                    </strong>
                    {editing ? (
                      <div className="dvoice-chat-edit">
                        <EmojiInlineInput
                          autoFocus
                          className="emoji-inline-input messenger-input"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                        />
                        <div className="dvoice-chat-edit-actions">
                          <button type="button" onClick={saveEdit}>{t(language, 'save')}</button>
                          <button type="button" className="ghost" onClick={cancelEdit}>{t(language, 'cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <p><MessageBody text={expandCustomEmojiShortcodes(m.body)} /></p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form className="messenger-compose dvoice-chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <div className="emoji-input-shell messenger-emoji-input">
              <EmojiInlineInput ref={inputRef} className="emoji-inline-input messenger-input" value={draft} placeholder={`${t(language, 'voiceChat')} #${channelName}`}
                onChange={(e) => setDraft(e.target.value)} />
              <button
                className="emoji-toggle inline chat-gif-toggle"
                type="button"
                aria-label="GIF"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setPickerTab('gif'); setEmojiOpen((value) => !(value && pickerTab === 'gif')); }}
              >
                <GifIcon />
              </button>
              <div ref={emojiAnchorRef} className="emoji-host inline">
                <button
                  className="emoji-toggle inline"
                  type="button"
                  aria-label={t(language, 'emoji')}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); setPickerTab('emoji'); setEmojiOpen((value) => !(value && pickerTab === 'emoji')); }}
                >
                  <EmojiToggleIcon />
                </button>
                {emojiOpen ? <EmojiPicker language={language} enlarged initialTab={pickerTab} anchorRef={emojiAnchorRef} placement="top-end" onSelect={insertEmoji} onSelectGif={sendGif} onClose={() => setEmojiOpen(false)} token={token} currentUser={currentUser} /> : null}
              </div>
            </div>
            {/* Submit on Enter; hidden submit keeps form submission working without a send button. */}
            <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
          </form>
        </div>
      ) : null}

      {/* Right-click menu for the user's own voice-chat messages. */}
      {messageMenu ? createPortal(
        <div className="context-menu" style={{ left: messageMenu.x, top: messageMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => beginEdit(messageMenu.message)}>
            {t(language, 'editMessage')}
          </button>
          <button type="button" className="danger" onClick={() => { voiceRoom.deleteChat(messageMenu.message.id); setMessageMenu(null); }}>
            {t(language, 'deleteMessage')}
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
