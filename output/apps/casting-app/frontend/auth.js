/**
 * auth.js — Production API-backed authentication
 *
 * Replaces all localStorage-based user/session management with backend JWT API.
 * Maintains the exact same public interface so app.js/kanban.js work unchanged.
 *
 * Allowed localStorage:
 *   casting_access_token  – JWT (cleared on logout)
 *   casting_refresh_token – refresh token (cleared on logout)
 *
 * Removed from localStorage:
 *   production-management-users-v1
 *   production-management-session-v1
 */
(function () {
  "use strict";

  const RBAC = window.ProductionRBAC;
  if (!RBAC) return;

  const API = window.CastingAPI;
  if (!API) {
    console.error("[auth] CastingAPI not loaded. Include api-client.js before auth.js.");
    return;
  }

  // Events that the rest of the app listens to — keep same names
  const usersChangedEvent = "productionAuthUsersChanged";
  const authChangedEvent  = "productionAuthSessionChanged";
  const sessionDurationMs = 8 * 60 * 60 * 1000; // kept for compatibility

  // ─── Anonymous sentinel ────────────────────────────────────────────────────
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

  // ─── currentUser helpers ───────────────────────────────────────────────────
  function setCurrentUser(user) {
    const safe = sanitizeUser(user) || anonymousUser;
    Object.keys(RBAC.currentUser).forEach((k) => delete RBAC.currentUser[k]);
    Object.assign(RBAC.currentUser, safe);
  }

  function getCurrentUser() {
    return sanitizeUser(RBAC.currentUser);
  }

  function isAuthenticated() {
    const u = RBAC.currentUser;
    return Boolean(u && u.id && u.id !== "anonymous" && u.isActive !== false);
  }

  function sanitizeUser(user) {
    if (!user || user.id === "anonymous") return null;
    const roleIds = uniqueArray([...(user.assignedRoleIds || []), ...(user.roleIds || [])]).map((id) =>
      id === "admin" ? "role_admin" : id
    );
    return {
      id:              String(user.id || ""),
      name:            String(user.name || ""),
      email:           String(user.email || ""),
      username:        String(user.username || user.email || ""),
      assignedRoleIds: roleIds,
      roleIds,
      permissions:     Array.isArray(user.permissions) ? user.permissions : [],
      isActive:        user.isActive !== false,
      createdAt:       user.createdAt  || "",
      updatedAt:       user.updatedAt  || "",
      lastLoginAt:     user.lastLoginAt || "",
    };
  }

  function sanitizeUserForAudit(user) {
    return sanitizeUser(user) || "";
  }

  // ─── Session restore on page load ─────────────────────────────────────────
  async function hydrateSession() {
    const token = API.getAccessToken();
    if (!token) {
      setCurrentUser(null);
      return null;
    }
    try {
      const me = await API.auth.me();
      const user = buildUserFromResponse(me);
      setCurrentUser(user);
      dispatchAuthChanged();
      scheduleSessionExpiry();
      return sanitizeUser(user);
    } catch {
      // Token invalid or expired — try refresh
      try {
        const rt = API.getRefreshToken();
        if (!rt) throw new Error("no refresh token");
        const refreshed = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!refreshed.ok) throw new Error("refresh failed");
        const data = await refreshed.json();
        API.setTokens(data.accessToken, data.refreshToken || "");
        const me2 = await API.auth.me();
        const user2 = buildUserFromResponse(me2);
        setCurrentUser(user2);
        dispatchAuthChanged();
        return sanitizeUser(user2);
      } catch {
        API.clearTokens();
        setCurrentUser(null);
        return null;
      }
    }
  }

  // ─── Login ─────────────────────────────────────────────────────────────────
  async function login(username, password) {
    if (!username || !password) {
      return { ok: false, error: "Email/username and password are required." };
    }

    try {
      const data = await API.auth.login(username.trim(), password);
      const user = buildUserFromResponse(data.user || data);
      setCurrentUser(user);
      dispatchAuthChanged();

      // Pre-fetch roles for RBAC
      if (RBAC.fetchRoles) {
        RBAC.fetchRoles().catch(() => {});
      }

      return { ok: true, user: sanitizeUser(user), session: getSession() };
    } catch (err) {
      const msg = err.message || "Invalid username or password.";
      if (err.status === 401 || err.status === 400) {
        return { ok: false, error: "Invalid username or password." };
      }
      if (err.status === 403) {
        return { ok: false, error: "Your account is inactive. Please contact Admin." };
      }
      if (err.status === 0) {
        return { ok: false, error: "Cannot reach server. Please check your connection." };
      }
      return { ok: false, error: msg };
    }
  }

  // ─── Logout ────────────────────────────────────────────────────────────────
  async function logout(options = {}) {
    try { await API.auth.logout(); } catch {}
    setCurrentUser(null);
    dispatchAuthChanged();
  }

  // ─── Session (compatibility stub) ─────────────────────────────────────────
  function getSession() {
    if (!isAuthenticated()) return null;
    const token = API.getAccessToken();
    if (!token) return null;
    // Decode expiry from JWT payload (non-verified, display only)
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return {
        userId:    RBAC.currentUser.id,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + sessionDurationMs).toISOString(),
        token,
      };
    } catch {
      return { userId: RBAC.currentUser.id, expiresAt: new Date(Date.now() + sessionDurationMs).toISOString(), token };
    }
  }

  // ─── Users (API-backed) ────────────────────────────────────────────────────
  async function getUsers() {
    try {
      const data = await API.users.list();
      return Array.isArray(data) ? data.map(sanitizeUser).filter(Boolean) : [];
    } catch { return []; }
  }

  async function getUser(userId) {
    try {
      const data = await API.users.list();
      const found = Array.isArray(data) ? data.find((u) => u.id === userId) : null;
      return found ? sanitizeUser(found) : null;
    } catch { return null; }
  }

  async function saveUser(userInput = {}) {
    const { id, password, confirmPassword, assignedRoleIds, roleIds, name, email, username, isActive } = userInput;
    const roleList = assignedRoleIds || roleIds || [];

    try {
      let saved;
      if (id && id !== "anonymous") {
        saved = await API.users.update(id, { name, email, username: username || email, isActive, assignedRoleIds: roleList });
        if (roleList.length) {
          await API.users.assignRoles(id, { roleIds: roleList });
        }
        if (password) {
          await API.users.resetPassword(id, { password, confirmPassword });
        }
      } else {
        saved = await API.users.create({ name, email, username: username || email, password, confirmPassword, assignedRoleIds: roleList });
      }

      window.dispatchEvent(new CustomEvent(usersChangedEvent, { detail: {} }));
      return { created: !id, passwordChanged: Boolean(password), user: sanitizeUser(saved) };
    } catch (err) {
      throw new Error(err.message || "Failed to save user.");
    }
  }

  async function deactivateUser(userId) {
    try {
      await API.users.deactivate(userId);
      if (RBAC.currentUser.id === userId) await logout({ reason: "Account deactivated" });
      window.dispatchEvent(new CustomEvent(usersChangedEvent, { detail: {} }));
      return { user: { id: userId, isActive: false } };
    } catch (err) {
      throw new Error(err.message || "Failed to deactivate user.");
    }
  }

  async function resetPassword(userId, password, confirmPassword) {
    const errors = validatePassword(password, confirmPassword, true);
    if (errors.length) throw new Error(errors[0]);
    try {
      await API.users.resetPassword(userId, { password, confirmPassword });
      return { user: { id: userId } };
    } catch (err) {
      throw new Error(err.message || "Failed to reset password.");
    }
  }

  // ─── Password validation (kept for UI-side checks) ─────────────────────────
  function validatePassword(password, confirmPassword, required = true) {
    const v = String(password || "");
    const c = String(confirmPassword || "");
    const msgs = [];
    if (!v && !c && !required) return msgs;
    if (!v)                             msgs.push("Password is required.");
    if (v.length < 8)                   msgs.push("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(v))              msgs.push("Password must include at least 1 uppercase letter.");
    if (!/[a-z]/.test(v))              msgs.push("Password must include at least 1 lowercase letter.");
    if (!/[0-9]/.test(v))              msgs.push("Password must include at least 1 number.");
    if (!/[^A-Za-z0-9]/.test(v))       msgs.push("Password must include at least 1 special character.");
    if (v !== c)                        msgs.push("Confirm password must match.");
    return msgs;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function buildUserFromResponse(apiUser) {
    if (!apiUser) return null;
    // Backend returns roles as array of objects or as flat permission strings
    const roleIds = Array.isArray(apiUser.roleIds)
      ? apiUser.roleIds
      : Array.isArray(apiUser.assignedRoles)
        ? apiUser.assignedRoles.map((r) => r.id)
        : Array.isArray(apiUser.roles)
          ? apiUser.roles.map((r) => r.id || r)
          : [];

    const permissions = Array.isArray(apiUser.permissions) ? apiUser.permissions : [];

    return {
      ...apiUser,
      assignedRoleIds: roleIds,
      roleIds,
      permissions,
    };
  }

  function dispatchAuthChanged() {
    window.dispatchEvent(new CustomEvent(authChangedEvent, {
      detail: { user: getCurrentUser(), session: getSession() }
    }));
  }

  function scheduleSessionExpiry() {
    // app.js calls scheduleSessionExpiry itself; this is a no-op here
  }

  function uniqueArray(values) {
    return [...new Set(values.filter(Boolean))];
  }

  // ─── Handle global auth-expired event from api-client ─────────────────────
  window.addEventListener("castingAuthExpired", () => {
    setCurrentUser(null);
    dispatchAuthChanged();
  });

  // ─── Hydrate session on load ───────────────────────────────────────────────
  hydrateSession();

  // ─── Expose on RBAC (same interface as original auth.js) ──────────────────
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
