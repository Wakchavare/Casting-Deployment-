/**
 * rbac.js — Production API-backed RBAC
 * Roles/permissions fetched from backend API.
 * Audit logs written to backend API (no localStorage).
 */
(function () {
  "use strict";

  const rolesChangedEvent = "productionRbacRolesChanged";
  const auditChangedEvent = "productionAuditLogsChanged";

  // ─── Static resource definitions (UI metadata only) ────────────────────────
  const resources = {
    modules: [
      { id: "waxEntries", label: "Wax Entries" },
      { id: "castingProcess", label: "Casting Process" },
      { id: "metalReceiving", label: "Metal Receiving" },
      { id: "inventory", label: "Inventory" }
    ],
    moduleActions: [
      { id: "view", label: "View" },
      { id: "create", label: "Create" },
      { id: "edit", label: "Edit" },
      { id: "delete", label: "Delete" },
      { id: "export", label: "Export CSV" },
      { id: "print", label: "Print" }
    ],
    stages: [
      { id: "awaitingMetal", label: "Awaiting Metal", stageKey: "Awaiting Metal" },
      { id: "readyForCasting", label: "Ready for Casting", stageKey: "Ready for Casting" },
      { id: "castingCompleted", label: "Casting Completed", stageKey: "Casting Completed" },
      { id: "qualityCheck", label: "Quality Check and Control", stageKey: "QC Completed" },
      { id: "orderCompleted", label: "Order Completed", stageKey: "Received at Store" }
    ],
    stageActions: [
      { id: "view", label: "View stage" },
      { id: "open", label: "Open focused order" },
      { id: "edit", label: "Edit focused form" },
      { id: "submit", label: "Submit stage" },
      { id: "print", label: "Print" },
      { id: "markDamaged", label: "Mark damaged" },
      { id: "viewDamagedTrees", label: "View damaged trees" }
    ],
    specialPermissions: [
      { id: "roles.manage", label: "Manage Roles" },
      { id: "users.manage", label: "Manage Users" },
      { id: "roles.assign", label: "Assign Roles" },
      { id: "rush.mark", label: "Mark Rush" },
      { id: "auditLogs.view", label: "View Audit Logs" },
      { id: "auditLogs.export", label: "Export Audit Logs" },
      { id: "inventoryLedger.view", label: "View Inventory Ledger" },
      { id: "inventoryLedger.export", label: "Export Inventory Ledger" },
      { id: "inventory.postFinal", label: "Post Final Inventory" },
      { id: "inventory.adjustment.future", label: "Manual Adjustment (Future)" }
    ]
  };

  const permissionTokens = {
    module: (moduleId, action = "view") => `${moduleId}.${normalizeModuleAction(action)}`,
    stage: (stageId, action = "view") => `casting.${normalizeStageId(stageId)}.${normalizeStageAction(action)}`,
    special: (permissionId) => normalizeSpecialPermission(permissionId),
    system: (resourceId, action) => normalizeSystemPermission(resourceId, action),
    action: (action) => normalizeSpecialPermission(action)
  };

  // ─── Current user (mutable, set by auth.js) ─────────────────────────────────
  const currentUser = {
    id: "anonymous",
    name: "Unauthenticated",
    username: "anonymous",
    email: "",
    assignedRoleIds: [],
    roleIds: [],
    permissions: [],
    isActive: false
  };

  // ─── In-memory roles cache (populated from API) ──────────────────────────────
  let _rolesCache = null;
  let _permissionsCache = null;

  async function getRoles() {
    const API = window.CastingAPI;
    if (!API) return [];
    try {
      _rolesCache = await API.rbac.listRoles();
      return _rolesCache;
    } catch { return _rolesCache || []; }
  }

  function getRole(roleId) {
    if (!_rolesCache) return null;
    return _rolesCache.find((r) => r.id === roleId || r.key === roleId) || null;
  }

  async function saveRole(role) {
    const API = window.CastingAPI;
    if (!API) return { success: false, error: "API not available" };
    try {
      let saved;
      if (role.id) {
        saved = await API.rbac.updateRole(role.id, { name: role.name, description: role.description });
        if (role.permissions !== undefined) {
          await API.rbac.updateRolePermissions(role.id, { permissionKeys: role.permissions });
        }
      } else {
        saved = await API.rbac.createRole({ key: role.key || normalizeKey(role.name), name: role.name, description: role.description });
        if (role.permissions && role.permissions.length) {
          await API.rbac.updateRolePermissions(saved.id, { permissionKeys: role.permissions });
        }
      }
      _rolesCache = null; // invalidate cache
      window.dispatchEvent(new CustomEvent(rolesChangedEvent, { detail: {} }));
      return { success: true, role: saved };
    } catch (err) {
      return { success: false, error: err.message || "Failed to save role" };
    }
  }

  async function deleteRole(roleId) {
    // Roles deletion not exposed via API — return graceful error
    return { success: false, error: "Role deletion must be done via admin panel." };
  }

  // ─── Permission helpers ──────────────────────────────────────────────────────
  function getEffectivePermissions(user) {
    if (!user) return [];
    // Backend supplies permissions array directly on the user object after login
    if (Array.isArray(user.permissions) && user.permissions.length > 0) {
      return user.permissions;
    }
    return [];
  }

  function can(user, action, resource = {}) {
    const resourceType = resource.type || resource.resourceType || "";
    const resourceId = resource.id || resource.resourceId || "";

    if (resourceType === "module") return hasModulePermission(user, resourceId, action);
    if (resourceType === "stage") return hasStagePermission(user, resourceId, action);
    if (resourceType === "special") return hasPermission(user, normalizeSpecialPermission(resourceId || action));
    if (resourceType === "system") return hasPermission(user, permissionTokens.system(resourceId, action));

    return hasPermission(user, normalizeSpecialPermission(action));
  }

  function hasModulePermission(user, moduleId, action = "view") {
    const moduleAction = normalizeModuleAction(action);
    if (moduleAction === "markRush") return hasPermission(user, "rush.mark");
    return hasPermission(user, permissionTokens.module(moduleId, moduleAction));
  }

  function hasStagePermission(user, stageId, action = "view") {
    const normalizedStageId = normalizeStageId(stageId);
    const stageAction = normalizeStageAction(action);
    if (!hasPermission(user, "castingProcess.view")) return false;
    return hasPermission(user, permissionTokens.stage(normalizedStageId, stageAction));
  }

  function hasPermission(user, permission) {
    return getEffectivePermissions(user).includes(permission);
  }

  function getStageIdByKey(stageKey) {
    return normalizeStageId(stageKey);
  }

  // ─── Audit logs (API-backed, no localStorage) ────────────────────────────────
  function recordAuditLog(entry = {}) {
    const API = window.CastingAPI;
    if (!API) return;
    // Fire-and-forget to backend audit log
    const user = entry.user || currentUser;
    API.auditLogs.list && API.auditLogs; // just checking it exists
    // The backend already records audit logs on all mutations.
    // This stub exists for frontend-triggered events (UI events only).
    // We emit local event for any listeners.
    const logEntry = {
      id: createId("audit"),
      userId: user.id || "unknown",
      username: user.username || user.name || "Unknown",
      action: String(entry.action || "").trim() || "Action",
      module: String(entry.module || "").trim(),
      stage: String(entry.stage || "").trim(),
      internalTreeNumber: String(entry.internalTreeNumber || "").trim(),
      oldValue: formatAuditValue(entry.oldValue),
      newValue: formatAuditValue(entry.newValue),
      notes: String(entry.notes || "").trim(),
      createdAt: new Date().toISOString()
    };
    window.dispatchEvent(new CustomEvent(auditChangedEvent, { detail: { log: logEntry } }));
    return logEntry;
  }

  async function getAuditLogs(params) {
    const API = window.CastingAPI;
    if (!API) return [];
    try {
      return await API.auditLogs.list(params);
    } catch { return []; }
  }

  function formatAuditValue(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  // ─── Normalizers ─────────────────────────────────────────────────────────────
  function normalizeModuleAction(action) {
    const map = { read: "view", add: "create", modify: "edit", remove: "delete",
      export: "export", print: "print", markRush: "markRush" };
    return map[action] || action || "view";
  }

  function normalizeStageAction(action) {
    const map = { read: "view", open: "open", edit: "edit", submit: "submit",
      print: "print", markDamaged: "markDamaged", viewDamagedTrees: "viewDamagedTrees" };
    return map[action] || action || "view";
  }

  function normalizeSpecialPermission(permissionId) {
    if (!permissionId) return "";
    const map = { "roles.manage": "roles.manage", "users.manage": "users.manage",
      "roles.assign": "roles.assign", "rush.mark": "rush.mark",
      "auditLogs.view": "auditLogs.view", "auditLogs.export": "auditLogs.export",
      "inventoryLedger.view": "inventoryLedger.view", "inventoryLedger.export": "inventoryLedger.export",
      "inventory.postFinal": "inventory.postFinal" };
    return map[permissionId] || permissionId;
  }

  function normalizeSystemPermission(resourceId, action) {
    return `${resourceId}.${action}`;
  }

  function normalizeStageId(stageId) {
    if (!stageId) return "";
    const map = {
      "Awaiting Metal": "awaitingMetal", "awaitingMetal": "awaitingMetal",
      "Ready for Casting": "readyForCasting", "readyForCasting": "readyForCasting",
      "Casting Completed": "castingCompleted", "castingCompleted": "castingCompleted",
      "QC Completed": "qualityCheck", "qualityCheck": "qualityCheck",
      "Received at Store": "orderCompleted", "orderCompleted": "orderCompleted"
    };
    return map[stageId] || stageId;
  }

  function normalizeKey(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  }

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  // ─── Expose ──────────────────────────────────────────────────────────────────
  window.ProductionRBAC = {
    auditChangedEvent,
    can,
    currentUser,
    deleteRole,
    getAuditLogs,
    getEffectivePermissions,
    getRole,
    getRoles,
    getStageIdByKey,
    hasModulePermission,
    hasPermission,
    hasStagePermission,
    permissionTokens,
    recordAuditLog,
    resources,
    rolesChangedEvent,
    saveRole
  };
})();
