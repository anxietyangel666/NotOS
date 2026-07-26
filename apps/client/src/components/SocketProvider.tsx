/**
 * SocketProvider — creates exactly ONE Socket.IO connection for the entire
 * authenticated session and exposes it via SocketContext.
 *
 * Previously Desktop, MessengerWindow, DesktopWall and RemoteDesktopWindow
 * each called `io(getApiBaseUrl(), { auth: { token } })` independently, resulting in
 * 3-4 simultaneous WebSocket connections. This provider collapses them into one.
 *
 * Usage:
 *   <SocketProvider token={token}>
 *     <Desktop ... />
 *   </SocketProvider>
 *
 * Children consume the socket via `useSocket()` from `../hooks/use-socket`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL_CHANGED_EVENT, getApiBaseUrl } from '../api/client';
import { SocketContext } from '../hooks/use-socket';
import { loadUserStatus, STATUS_CHANGED_EVENT, type UserStatusState } from '../utils/user-status';

type Props = {
  token: string;
  children: ReactNode;
};

type SharedSocketEntry = {
  key: string;
  socket: Socket;
  refs: number;
  disconnectTimer: number | null;
};

let sharedSocketEntry: SharedSocketEntry | null = null;

function getSharedSocket(apiUrl: string, token: string) {
  const key = `${apiUrl}|${token}`;
  if (sharedSocketEntry?.key !== key) {
    if (sharedSocketEntry) {
      if (sharedSocketEntry.disconnectTimer !== null) {
        window.clearTimeout(sharedSocketEntry.disconnectTimer);
      }
      sharedSocketEntry.socket.disconnect();
    }
    sharedSocketEntry = {
      key,
      socket: io(apiUrl, {
        auth: { token, presenceStatus: loadUserStatus().status },
        transports: ['websocket'],
        upgrade: false
      }),
      refs: 0,
      disconnectTimer: null
    };
  }

  if (sharedSocketEntry.disconnectTimer !== null) {
    window.clearTimeout(sharedSocketEntry.disconnectTimer);
    sharedSocketEntry.disconnectTimer = null;
  }

  sharedSocketEntry.refs += 1;
  return sharedSocketEntry;
}

function releaseSharedSocket(entry: SharedSocketEntry) {
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;

  entry.disconnectTimer = window.setTimeout(() => {
    if (entry.refs > 0) return;
    entry.socket.disconnect();
    if (sharedSocketEntry === entry) sharedSocketEntry = null;
  }, 250);
}

export function SocketProvider({ token, children }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [apiUrl, setApiUrl] = useState(() => getApiBaseUrl());

  useEffect(() => {
    const onApiUrlChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setApiUrl(detail || getApiBaseUrl());
    };
    window.addEventListener(API_URL_CHANGED_EVENT, onApiUrlChange as EventListener);
    return () => window.removeEventListener(API_URL_CHANGED_EVENT, onApiUrlChange as EventListener);
  }, []);

  useEffect(() => {
    const entry = getSharedSocket(apiUrl, token);
    const instance = entry.socket;
    socketRef.current = instance;
    setSocket(instance);

    const emitPresence = () => {
      instance.emit('presence:setStatus', { status: loadUserStatus().status });
    };
    const onStatusChange = (event: Event) => {
      const detail = (event as CustomEvent<UserStatusState>).detail;
      instance.emit('presence:setStatus', { status: detail?.status ?? loadUserStatus().status });
    };
    instance.on('connect', emitPresence);
    window.addEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
    emitPresence();

    return () => {
      instance.off('connect', emitPresence);
      window.removeEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
      releaseSharedSocket(entry);
      socketRef.current = null;
      setSocket(null);
    };
  }, [apiUrl, token]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}
