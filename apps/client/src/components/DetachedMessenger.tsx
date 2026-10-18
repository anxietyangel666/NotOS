import { useCallback, useEffect } from 'react';
import type { Language, PublicUser } from '../api/types';
import { MessengerWindow } from './MessengerWindow';

type DetachedMessengerProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  onUserChange: (user: PublicUser) => void;
  onLogout: () => void;
  initialChatUserId?: string | null;
  initialGroupId?: string | null;
};

export function DetachedMessenger({
  token,
  language,
  currentUser,
  onUserChange,
  onLogout,
  initialChatUserId,
  initialGroupId
}: DetachedMessengerProps) {
  const handleDock = useCallback(async () => {
    if (window.notoc?.dockMessenger) {
      await window.notoc.dockMessenger();
    } else {
      window.close();
    }
  }, []);

  // Listen for broadcast channel 'dock' messages
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('notoc-messenger-channel');
      bc.onmessage = (event) => {
        if (event.data?.type === 'dock') {
          if (window.notoc?.closeWindow) {
            void window.notoc.closeWindow();
          } else {
            window.close();
          }
        }
      };
    } catch {}

    return () => {
      try { bc?.close(); } catch {}
    };
  }, []);

  return (
    <div className="detached-messenger-root">
      <MessengerWindow
        token={token}
        language={language}
        currentUser={currentUser}
        initialChatUserId={initialChatUserId}
        initialGroupRequest={initialGroupId ? { groupId: initialGroupId, group: null as any, channelId: null, requestId: 1 } : null}
        maximized={true}
        zIndex={1}
        onFocus={() => {}}
        onClose={handleDock}
        onMinimize={() => void window.notoc?.minimizeWindow()}
        onToggleMaximize={() => void window.notoc?.toggleMaximizeWindow()}
        onViewDesktop={() => {}}
        onActiveChatChange={() => {}}
        onUserChange={onUserChange}
        isDetached={true}
        onDock={handleDock}
      />
    </div>
  );
}
