export type AuthRole = {
  id: string;
  key: string;
  name: string;
};

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  sessionId?: string;
  roles: AuthRole[];
  roleIds: string[];
  permissions: string[];
};
