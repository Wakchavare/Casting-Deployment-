/**
 * api-client.js
 * Production API client — replaces ALL localStorage business data persistence.
 * All requests are authenticated via Bearer JWT with automatic refresh.
 */
(function () {
  "use strict";

  const API_BASE = window.CASTING_API_URL || "/api";

  // ─── Token storage (access token only — short-lived) ───────────────────────
  // We store the access token in memory (closure), NOT localStorage.
  // The refresh token is sent as an httpOnly-style approach via request header
  // stored in sessionStorage for the tab lifetime only.
  let _accessToken = null;
  let _refreshToken = null;
  let _refreshPromise = null;

  function getAccessToken() { return _accessToken; }
  function getRefreshToken() { return _refreshToken; }

  function setTokens(accessToken, refreshToken) {
    _accessToken = accessToken;
    if (refreshToken) {
      _refreshToken = refreshToken;
      // Store refresh token in sessionStorage only (cleared on tab close)
      try { sessionStorage.setItem("casting-rt", refreshToken); } catch {}
    }
  }

  function clearTokens() {
    _accessToken = null;
    _refreshToken = null;
    try { sessionStorage.removeItem("casting-rt"); } catch {}
  }

  function loadRefreshTokenFromSession() {
    try { return sessionStorage.getItem("casting-rt"); } catch { return null; }
  }

  // ─── Core HTTP ─────────────────────────────────────────────────────────────
  async function request(method, path, body, retry = true) {
    const headers = { "Content-Type": "application/json" };
    if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);

    // Token expired — attempt silent refresh once
    if (res.status === 401 && retry && _refreshToken) {
      const refreshed = await silentRefresh();
      if (refreshed) return request(method, path, body, false);
      clearTokens();
      window.dispatchEvent(new CustomEvent("castingSessionExpired"));
      throw new ApiError(401, "Session expired. Please log in again.");
    }

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch { errBody = {}; }
      throw new ApiError(res.status, errBody.message || `HTTP ${res.status}`, errBody);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return res.json();
    return null;
  }

  async function silentRefresh() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      try {
        const rt = _refreshToken || loadRefreshTokenFromSession();
        if (!rt) return false;
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body);
  const put = (path, body) => request("PUT", path, body);
  const patch = (path, body) => request("PATCH", path, body);
  const del = (path) => request("DELETE", path);

  // ─── Error class ───────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(status, message, body) {
      super(message);
      this.status = status;
      this.body = body;
      this.name = "ApiError";
    }
  }

  // ─── Auth API ──────────────────────────────────────────────────────────────
  const auth = {
    async login(username, password) {
      const data = await post("/auth/login", { username, password });
      setTokens(data.accessToken, data.refreshToken);
      return data;
    },
    async logout(refreshToken) {
      try {
        await post("/auth/logout", { refreshToken: refreshToken || _refreshToken || "" });
      } finally {
        clearTokens();
      }
    },
    async refresh() {
      return silentRefresh();
    },
    async changePassword(currentPassword, newPassword, confirmPassword) {
      return post("/auth/change-password", { currentPassword, newPassword, confirmPassword });
    },
    async tryRestoreSession() {
      // Attempt to restore session from stored refresh token
      const rt = loadRefreshTokenFromSession();
      if (!rt) return null;
      _refreshToken = rt;
      const ok = await silentRefresh();
      if (!ok) { clearTokens(); return null; }
      // Fetch current user profile
      try {
        const me = await get("/auth/me");
        return me;
      } catch {
        clearTokens();
        return null;
      }
    },
  };

  // ─── Wax Entries API ───────────────────────────────────────────────────────
  const waxEntries = {
    list: () => get("/wax-entries"),
    create: (dto) => post("/wax-entries", dto),
    update: (id, dto) => patch(`/wax-entries/${id}`, dto),
    delete: (id) => del(`/wax-entries/${id}`),
  };

  // ─── Casting Workflow API ──────────────────────────────────────────────────
  const castingWorkflow = {
    list: () => get("/casting-workflow"),
    get: (id) => get(`/casting-workflow/${id}`),
    update: (waxEntryId, dto) => put(`/casting-workflow/by-wax-entry/${waxEntryId}`, dto),
  };

  // ─── Metal Receiving API ───────────────────────────────────────────────────
  const metalReceiving = {
    list: () => get("/metal-receiving"),
    create: (dto) => post("/metal-receiving", dto),
    update: (id, dto) => patch(`/metal-receiving/${id}`, dto),
    delete: (id) => del(`/metal-receiving/${id}`),
  };

  // ─── Inventory Ledger API ──────────────────────────────────────────────────
  const inventoryLedger = {
    list: () => get("/inventory-ledger"),
    byTree: (internalTreeNumber) => get(`/inventory-ledger/by-tree/${encodeURIComponent(internalTreeNumber)}`),
    post: (dto) => post("/inventory-ledger", dto),
    postBatch: (entries) => post("/inventory-ledger/batch", entries),
  };

  // ─── Users API ─────────────────────────────────────────────────────────────
  const users = {
    list: () => get("/users"),
    get: (id) => get(`/users/${id}`),
    create: (dto) => post("/users", dto),
    update: (id, dto) => patch(`/users/${id}`, dto),
    resetPassword: (id, dto) => post(`/users/${id}/reset-password`, dto),
    assignRoles: (id, dto) => post(`/users/${id}/assign-roles`, dto),
    deactivate: (id) => post(`/users/${id}/deactivate`, {}),
    activate: (id) => post(`/users/${id}/activate`, {}),
  };

  // ─── RBAC API ──────────────────────────────────────────────────────────────
  const rbac = {
    listRoles: () => get("/roles"),
    getRole: (id) => get(`/roles/${id}`),
    createRole: (dto) => post("/roles", dto),
    updateRole: (id, dto) => patch(`/roles/${id}`, dto),
    updateRolePermissions: (id, dto) => put(`/roles/${id}/permissions`, dto),
    listPermissions: () => get("/permissions"),
  };

  // ─── Audit Logs API ────────────────────────────────────────────────────────
  const auditLogs = {
    list: (params) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return get(`/audit-logs${qs}`);
    },
  };

  // ─── Expose global ─────────────────────────────────────────────────────────
  window.CastingAPI = {
    auth,
    waxEntries,
    castingWorkflow,
    metalReceiving,
    inventoryLedger,
    users,
    rbac,
    auditLogs,
    ApiError,
    setTokens,
    clearTokens,
    getAccessToken,
  };
})();
