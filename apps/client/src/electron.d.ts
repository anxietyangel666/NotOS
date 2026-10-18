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
      detachMessenger?(params?: { activeUserId?: string | null; activeGroupId?: string | null; token?: string }): Promise<{ ok: boolean }>;
      dockMessenger?(): Promise<{ ok: boolean }>;
      isMessengerDetached?(): Promise<boolean>;
      onMessengerDocked?(callback: () => void): () => void;
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
      setServerUrl?(url: string): Promise<{ ok: boolean; serverUrl?: string }>;
      getServerUrl?(): Promise<string>;
      startUpdate?(url: string): Promise<{ ok: boolean; filePath?: string; error?: string }>;
      applyUpdate?(filePath?: string): Promise<{ ok: boolean; error?: string }>;
      onUpdateProgress?(callback: (progress: { percent: number; downloaded: number; total: number }) => void): () => void;
      isWordMisspelled?(word: string): boolean;
      getWordSuggestions?(word: string): string[];
      addWordToDictionary?(word: string): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export {};
