/**
 * auth.js — Production API-backed authentication
 * All user/session data lives in PostgreSQL via backend API.
 * No localStorage for business data.
 */
(function () {
  "use strict";

  const RBAC = window.ProductionRBAC;
  if (!RBAC) return;

  const API = window.CastingAPI;
  if (!API) {
    console.error("[auth] CastingAPI not loaded.");
    return;
  }

  const authChangedEvent = "productionAuthSessionChanged";
  const usersChangedEvent = "productionAuthUsersChanged";
  const sessionDurationMs = 8 * 60 * 60 * 1000;

  const anonymousUser = {
    id: "anonymous",
    name: "Unauthenticated",
    username: "anonymous",
    email: "",
    assignedRoleIds: [],
    roleIds: [],
    permissions: [],
    isActive: false,
  };

  function getCurrentUser() {
    return sanitizeUser(RBAC.currentUser);
  }

  function setCurrentUser(user) {
    Object.keys(RBAC.currentUser).forEach((k) => delete RBAC.currentUser[k]);
    Object.assign(RBAC.currentUser, sanitizeUser(user) || anonymousUser);
  }

  function isAuthenticated() {
    const u = RBAC.currentUser;
    return Boolean(u && u.id && u.id !== "anonymous" && u.isActive !== false);
  }

  function sanitizeUser(user) {
    if (!user || user.id === "anonymous") return null;
    const roleIds = user.roleIds || user.assignedRoleIds || [];
    return {
      id: String(user.id || ""),
      name: String(user.name || ""),
      email: String(user.email || ""),
      username: String(user.username || user.email || ""),
      assignedRoleIds: roleIds,
      roleIds,
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
      isActive: user.isActive !== false,
      lastLoginAt: user.lastLoginAt || "",
    };
  }

  function sanitizeUserForAudit(user) {
    if (!user) return null;
    return { id: user.id, name: user.name, username: user.username, email: user.email };
  }

  async function login(username, password) {
    try {
      const data = await API.auth.login(username, password);
      const apiUser = data.user;
      const normalized = {
        ...apiUser,
        roleIds: apiUser.roleIds || [],
        assignedRoleIds: apiUser.roleIds || [],
        permissions: apiUser.permissions || [],
      };
      setCurrentUser(normalized);
      dispatchAuthChanged();
      return { success: true, user: normalized };
    } catch (err) {
      return { success: false, error: err.message || "Login failed" };
    }
  }

  async function logout() {
    try { await API.auth.logout(); } catch {}
    setCurrentUser(null);
    API.clearTokens();
    dispatchAuthChanged();
  }

  async function hydrateSession() {
    try {
      const me = await API.auth.tryRestoreSession();
      if (me) {
        const normalized = {
          ...me,
          roleIds: me.roleIds || [],
          assignedRoleIds: me.roleIds || [],
          permissions: me.permissions || [],
        };
        setCurrentUser(normalized);
        dispatchAuthChanged();
      }
    } catch {}
  }

  async function getUsers() {
    try { return await API.users.list(); } catch { return []; }
  }

  async function getUser(userId) {
    try { return await API.users.get(userId); } catch { return null; }
  }

  async function saveUser(userInput = {}) {
    const { id, password, confirmPassword, assignedRoleIds, roleIds, ...rest } = userInput;
    const roleList = assignedRoleIds || roleIds || [];
    try {
      let saved;
      if (id && id !== "anonymous") {
        saved = await API.users.update(id, { ...rest, assignedRoleIds: roleList });
      } else {
        saved = await API.users.create({ ...rest, password, confirmPassword, assignedRoleIds: roleList });
      }
      window.dispatchEvent(new CustomEvent(usersChangedEvent, { detail: {} }));
      return { success: true, user: saved };
    } catch (err) {
      return { success: false, error: err.message || "Failed to save user" };
    }
  }

  async function deactivateUser(userId) {
    try {
      await API.users.deactivate(userId);
      if (RBAC.currentUser.id === userId) await logout();
      window.dispatchEvent(new CustomEvent(usersChangedEvent, { detail: {} }));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function resetPassword(userId, password, confirmPassword) {
    const v = validatePassword(password, confirmPassword);
    if (!v.valid) return { success: false, error: v.error };
    try {
      await API.users.resetPassword(userId, { password, confirmPassword });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || "Failed to reset password" };
    }
  }

  function validatePassword(password, confirmPassword, required = true) {
    if (required && !password) return { valid: false, error: "Password is required." };
    if (password && password.length < 8) return { valid: false, error: "Password must be at least 8 characters." };
    if (confirmPassword !== undefined && password !== confirmPassword)
      return { valid: false, error: "Passwords do not match." };
    return { valid: true };
  }

  function getSession() {
    if (!isAuthenticated()) return null;
    return { userId: RBAC.currentUser.id, expiresAt: Date.now() + sessionDurationMs };
  }

  function dispatchAuthChanged() {
    window.dispatchEvent(new CustomEvent(authChangedEvent, {
      detail: { user: getCurrentUser(), isAuthenticated: isAuthenticated() },
    }));
  }

  window.addEventListener("castingSessionExpired", () => {
    setCurrentUser(null);
    dispatchAuthChanged();
  });

  hydrateSession();

  Object.assign(RBAC, {
    authChangedEvent,
    deactivateUser,
    getCurrentUser,
    getSession,
    getUser,
    getUsers,
    hydrateSession,
    isAuthenticated,
    login,
    logout,
    resetPassword,
    sanitizeUserForAudit,
    saveUser,
    sessionDurationMs,
    usersChangedEvent,
    validatePassword,
  });
})();
