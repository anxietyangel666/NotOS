import type { AuthFileBundle, PublicUser } from './api/types';

export type AuthNotice = {
  title: string;
  message: string;
  recoveryKey?: string;
  authFile?: AuthFileBundle;
};

export type AuthResult = {
  token: string;
  user: PublicUser;
};
