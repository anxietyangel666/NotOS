/**
 * Shared Socket.IO connection hook.
 *
 * Returns the single socket instance managed by SocketProvider.
 * Import `SocketProvider` in App.tsx (or the authenticated root) and wrap
 * the component tree so that Desktop, MessengerWindow, DesktopWall and
 * RemoteDesktopWindow all share one WebSocket connection instead of each
 * creating their own.
 */
import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

export const SocketContext = createContext<Socket | null>(null);

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
