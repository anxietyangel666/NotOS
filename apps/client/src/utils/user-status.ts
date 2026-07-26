// Discord-style self presence status. This is a client-side preference that
// drives the colored status dot shown in the taskbar user panel and the
// voice mute / deafen toggles in the popout panel.

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export type VoiceSelfState = {
  // Self mute (microphone off).
  muted: boolean;
  // Deafen (output off). Deafening also implies the mic is muted, mirroring
  // Discord behaviour.
  deafened: boolean;
};

export type UserStatusState = {
  status: PresenceStatus;
  voice: VoiceSelfState;
};

import { useEffect, useState } from 'react';

const STATUS_KEY = 'notoc.userStatus';

export const STATUS_CHANGED_EVENT = 'notoc:userStatusChanged';

export const DEFAULT_USER_STATUS: UserStatusState = {
  status: 'online',
  voice: { muted: false, deafened: false }
};

export const PRESENCE_ORDER: PresenceStatus[] = ['online', 'idle', 'dnd', 'invisible'];

function isPresenceStatus(value: unknown): value is PresenceStatus {
  return value === 'online' || value === 'idle' || value === 'dnd' || value === 'invisible';
}

export function loadUserStatus(): UserStatusState {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return { ...DEFAULT_USER_STATUS, voice: { ...DEFAULT_USER_STATUS.voice } };
    const parsed = JSON.parse(raw) as Partial<UserStatusState>;
    return {
      status: isPresenceStatus(parsed.status) ? parsed.status : 'online',
      voice: {
        muted: Boolean(parsed.voice?.muted) || Boolean(parsed.voice?.deafened),
        deafened: Boolean(parsed.voice?.deafened)
      }
    };
  } catch {
    return { ...DEFAULT_USER_STATUS, voice: { ...DEFAULT_USER_STATUS.voice } };
  }
}

export function saveUserStatus(state: UserStatusState): void {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  // Let any other live consumer (voice room, presence dot) react immediately.
  window.dispatchEvent(new CustomEvent<UserStatusState>(STATUS_CHANGED_EVENT, { detail: state }));
}

// Reactive subscription to the current user's status/voice state. Any component
// can call this to render the live self presence dot / mute state and stay in
// sync with changes made from the taskbar panel or the active call.
export function useUserStatus(): UserStatusState {
  const [state, setState] = useState<UserStatusState>(loadUserStatus);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<UserStatusState>).detail;
      setState(detail ?? loadUserStatus());
    };
    window.addEventListener(STATUS_CHANGED_EVENT, onChange as EventListener);
    return () => window.removeEventListener(STATUS_CHANGED_EVENT, onChange as EventListener);
  }, []);
  return state;
}

// Update only the voice (mute/deafen) part, preserving the presence status.
// Returns the merged state. Used by the live voice call to keep the global
// store and the taskbar panel in sync without clobbering the chosen status.
export function patchVoiceState(voice: Partial<VoiceSelfState>): UserStatusState {
  const current = loadUserStatus();
  const merged: UserStatusState = {
    status: current.status,
    voice: {
      deafened: voice.deafened ?? current.voice.deafened,
      muted: (voice.muted ?? current.voice.muted) || (voice.deafened ?? current.voice.deafened)
    }
  };
  saveUserStatus(merged);
  return merged;
}
