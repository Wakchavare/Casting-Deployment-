import { AuthUser } from '../../auth/types/auth-user';

export type AuthenticatedRequest = {
  user?: AuthUser;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  route?: {
    path?: string;
  };
};
