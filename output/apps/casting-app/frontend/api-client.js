/**
 * api-client.js
 * Central API client for Casting Production Management.
 * Handles JWT auth, token refresh, 401/403, and clean error reporting.
 * No production business data is stored in localStorage.
 *
 * Allowed localStorage keys:
 *   casting_access_token  – short-lived JWT (cleared on logout)
 *   casting_refresh_token – refresh token (cleared on logout)
 */

(function () {
  "use strict";

  const API_BASE_URL = "/api";
  const ACCESS_TOKEN_KEY  = "casting_access_token";
  const REFRESH_TOKEN_KEY = "casting_refresh_token";

  // ─── Token helpers ──────────────────────────────────────────────────────────
  function getAccessToken()  { return localStorage.getItem(ACCESS_TOKEN_KEY)  || ""; }
  function getRefreshToken() { return localStorage.getItem(REFRESH_TOKEN_KEY) || ""; }

  function setTokens(accessToken, refreshToken) {
    if (accessToken)  localStorage.setItem(ACCESS_TOKEN_KEY,  accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }

  function clearTokens() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  // ─── In-flight refresh de-duplication ────────────────────────────────────────
  let _refreshPromise = null;

  async function attemptTokenRefresh() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      const rt = getRefreshToken();
      if (!rt) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken || "");
        return true;
      } catch {
        return false;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  // ─── ApiError class ──────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(status, message, body) {
      super(message);
      this.name    = "ApiError";
      this.status  = status;
      this.body    = body;
    }
  }

  // ─── Core request ────────────────────────────────────────────────────────────
  async function request(method, path, body, isRetry) {
    const headers = { "Content-Type": "application/json" };
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, init);
    } catch (networkError) {
      throw new ApiError(0, "Network error — server unreachable. Check your connection.", {});
    }

    // Token expired — try silent refresh once
    if (res.status === 401 && !isRetry) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) return request(method, path, body, true);

      // Refresh failed — force logout
      clearTokens();
      window.dispatchEvent(new CustomEvent("castingAuthExpired"));
      throw new ApiError(401, "Session expired. Please log in again.", {});
    }

    if (res.status === 403) {
      throw new ApiError(403, "You do not have permission to perform this action.", {});
    }

    if (res.status === 409) {
      let errBody = {};
      try { errBody = await res.json(); } catch {}
      throw new ApiError(409, errBody.message || "Conflict — duplicate entry detected.", errBody);
    }

    if (!res.ok) {
      let errBody = {};
      try { errBody = await res.json(); } catch {}
      const message =
        errBody.message ||
        errBody.error   ||
        `Server error (${res.status})`;
      throw new ApiError(res.status, Array.isArray(message) ? message.join(" ") : String(message), errBody);
    }

    if (res.status === 204) return null;

    try { return await res.json(); }
    catch { return null; }
  }

  const get    = (path)        => request("GET",    path, undefined, false);
  const post   = (path, body)  => request("POST",   path, body,      false);
  const patch  = (path, body)  => request("PATCH",  path, body,      false);
  const put    = (path, body)  => request("PUT",    path, body,      false);
  const del    = (path)        => request("DELETE", path, undefined, false);

  // ─── Auth ─────────────────────────────────────────────────────────────────────
  const auth = {
    async login(username, password) {
      const data = await post("/auth/login", { username, password });
      setTokens(data.accessToken, data.refreshToken || "");
      return data; // { accessToken, refreshToken, user }
    },
    async logout() {
      try {
        const rt = getRefreshToken();
        if (rt) await post("/auth/logout", { refreshToken: rt });
      } catch {}
      clearTokens();
    },
    me: () => get("/auth/me"),
  };

  // ─── Wax Entries ──────────────────────────────────────────────────────────────
  const waxEntries = {
    list:   ()         => get("/wax-entries"),
    create: (dto)      => post("/wax-entries", dto),
    update: (id, dto)  => patch(`/wax-entries/${id}`, dto),
    delete: (id)       => del(`/wax-entries/${id}`),
  };

  // ─── Casting Workflow ─────────────────────────────────────────────────────────
  const castingWorkflow = {
    list:            ()           => get("/casting-workflow"),
    get:             (id)         => get(`/casting-workflow/${id}`),
    updateByWaxEntry:(waxId, dto) => put(`/casting-workflow/by-wax-entry/${waxId}`, dto),
  };

  // ─── Metal Receiving ──────────────────────────────────────────────────────────
  const metalReceiving = {
    list:   ()         => get("/metal-receiving"),
    create: (dto)      => post("/metal-receiving", dto),
    update: (id, dto)  => patch(`/metal-receiving/${id}`, dto),
    delete: (id)       => del(`/metal-receiving/${id}`),
  };

  // ─── Inventory Ledger ─────────────────────────────────────────────────────────
  const inventoryLedger = {
    list:    ()      => get("/inventory-ledger"),
    byTree:  (treeNo) => get(`/inventory-ledger/by-tree/${encodeURIComponent(treeNo)}`),
    post:    (dto)   => post("/inventory-ledger", dto),
    batch:   (arr)   => post("/inventory-ledger/batch", arr),
  };

  // ─── Users ────────────────────────────────────────────────────────────────────
  const users = {
    list:          ()           => get("/users"),
    create:        (dto)        => post("/users", dto),
    update:        (id, dto)    => patch(`/users/${id}`, dto),
    resetPassword: (id, dto)    => post(`/users/${id}/reset-password`, dto),
    assignRoles:   (id, dto)    => post(`/users/${id}/assign-roles`, dto),
    activate:      (id)         => post(`/users/${id}/activate`, {}),
    deactivate:    (id)         => post(`/users/${id}/deactivate`, {}),
  };

  // ─── Roles & Permissions ──────────────────────────────────────────────────────
  const roles = {
    list:               ()          => get("/roles"),
    get:                (id)        => get(`/roles/${id}`),
    create:             (dto)       => post("/roles", dto),
    update:             (id, dto)   => patch(`/roles/${id}`, dto),
    updatePermissions:  (id, dto)   => put(`/roles/${id}/permissions`, dto),
    listPermissions:    ()          => get("/permissions"),
  };

  // ─── Audit Logs ───────────────────────────────────────────────────────────────
  const auditLogs = {
    list:   (params) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return get(`/audit-logs${qs}`);
    },
    export: (params) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return get(`/audit-logs/export${qs}`);
    },
  };

  // ─── Expose globally ─────────────────────────────────────────────────────────
  window.CastingAPI = {
    // token helpers
    getAccessToken,
    getRefreshToken,
    setTokens,
    clearTokens,
    // namespaced API modules
    auth,
    waxEntries,
    castingWorkflow,
    metalReceiving,
    inventoryLedger,
    users,
    roles,
    auditLogs,
    // error class
    ApiError,
  };
})();
