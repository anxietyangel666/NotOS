import type { AuthFileBundle } from './api/types';

type NativeFileResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      content: string;
    };

type NativeImageResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      dataUrl: string;
    };

type NativeSaveResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
    };

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string;
  isScreen: boolean;
};

declare global {
  interface Window {
    notoc?: {
      platform: 'electron';
      saveAuthFile(authFile: AuthFileBundle): Promise<NativeSaveResult>;
      openAuthFile(): Promise<NativeFileResult>;
      openImageFile(): Promise<NativeImageResult>;
      minimizeWindow(): Promise<void>;
      toggleMaximizeWindow(): Promise<void>;
      closeWindow(): Promise<void>;
      getAppVersion?(): Promise<string>;
      restartApp?(): Promise<void>;
      setUnreadBadge?(count: number): Promise<{ ok: boolean }>;
      copyImageToClipboard?(dataUrl: string): Promise<{ ok: boolean }>;
      openExternal?(url: string): Promise<void>;
      getScreenSources?(): Promise<ScreenSource[]>;
      selectScreenSource?(sourceId: string): Promise<void>;
      registerPushToTalk?(code: string): Promise<{ ok: boolean; reason?: string; accelerator?: string }>;
      unregisterPushToTalk?(): Promise<{ ok: boolean }>;
      onPushToTalkDown?(callback: () => void): () => void;
      onPushToTalkUp?(callback: () => void): () => void;
    };
  }
}

export {};
