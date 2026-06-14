/**
 * SocketProvider — creates exactly ONE Socket.IO connection for the entire
 * authenticated session and exposes it via SocketContext.
 *
 * Previously Desktop, MessengerWindow, DesktopWall and RemoteDesktopWindow
 * each called `io(API_URL, { auth: { token } })` independently, resulting in
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
import { API_URL } from '../api/client';
import { SocketContext } from '../hooks/use-socket';

type Props = {
  token: string;
  children: ReactNode;
};

export function SocketProvider({ token, children }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const instance = io(API_URL, { auth: { token } });
    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [token]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}
