/**
 * rbac.js — Production API-backed RBAC
 *
 * Roles and permissions are sourced from the backend API.
 * The permission-checking logic (can, hasPermission, etc.) is kept exactly
 * as-is so the rest of the codebase works without changes.
 *
 * localStorage removed for: roles, permissions, audit logs.
 * All audit writes go to the backend; local audit reads fall back gracefully.
 */
(function () {
  "use strict";

  const rolesChangedEvent = "productionRbacRolesChanged";
  const auditChangedEvent = "productionAuditLogsChanged";

  // ─── Static UI resource definitions (metadata only, no localStorage) ─────────
  const resources = {
    modules: [
      { id: "waxEntries",     label: "Wax Entries" },
      { id: "castingProcess", label: "Casting Process" },
      { id: "metalReceiving", label: "Metal Receiving" },
      { id: "inventory",      label: "Inventory" }
    ],
    moduleActions: [
      { id: "view",   label: "View" },
      { id: "create", label: "Create" },
      { id: "edit",   label: "Edit" },
      { id: "delete", label: "Delete" },
      { id: "export", label: "Export CSV" },
      { id: "print",  label: "Print" }
    ],
    stages: [
      { id: "awaitingMetal",    label: "Awaiting Metal",              stageKey: "Awaiting Metal" },
      { id: "readyForCasting",  label: "Ready for Casting",           stageKey: "Ready for Casting" },
      { id: "castingCompleted", label: "Casting Completed",           stageKey: "Casting Completed" },
      { id: "qualityCheck",     label: "Quality Check and Control",   stageKey: "QC Completed" },
      { id: "orderCompleted",   label: "Order Completed",             stageKey: "Received at Store" }
    ],
    stageActions: [
      { id: "view",              label: "View stage" },
      { id: "open",              label: "Open focused order" },
      { id: "edit",              label: "Edit focused form" },
      { id: "submit",            label: "Submit stage" },
      { id: "print",             label: "Print" },
      { id: "markDamaged",       label: "Mark damaged" },
      { id: "viewDamagedTrees",  label: "View damaged trees" }
    ],
    specialPermissions: [
      { id: "roles.manage",                label: "Manage Roles" },
      { id: "users.manage",                label: "Manage Users" },
      { id: "roles.assign",                label: "Assign Roles" },
      { id: "rush.mark",                   label: "Mark Rush" },
      { id: "auditLogs.view",              label: "View Audit Logs" },
      { id: "auditLogs.export",            label: "Export Audit Logs" },
      { id: "inventoryLedger.view",        label: "View Inventory Ledger" },
      { id: "inventoryLedger.export",      label: "Export Inventory Ledger" },
      { id: "inventory.postFinal",         label: "Post Final Inventory" },
      { id: "inventory.adjustment.future", label: "Manual Adjustment (Future)" }
    ]
  };

  const permissionTokens = {
    module:  (moduleId, action = "view")  => `${moduleId}.${normalizeModuleAction(action)}`,
    stage:   (stageId,  action = "view")  => `casting.${normalizeStageId(stageId)}.${normalizeStageAction(action)}`,
    special: (permissionId)               => normalizeSpecialPermission(permissionId),
    system:  (resourceId, action)         => normalizeSystemPermission(resourceId, action),
    action:  (action)                     => normalizeSpecialPermission(action)
  };

  // ─── Current user (in-memory, set by auth.js after login) ────────────────────
  const currentUser = {
    id: "anonymous",
    name: "Unauthenticated",
    username: "anonymous",
    email: "",
    assignedRoleIds: [],
    roleIds: [],
    permissions: [],   // flat array of permission keys from backend
    isActive: false
  };

  // ─── In-memory roles cache (populated from API) ───────────────────────────────
  let _cachedRoles = null;

  async function fetchRoles() {
    if (!window.CastingAPI) return [];
    try {
      const data = await window.CastingAPI.roles.list();
      _cachedRoles = Array.isArray(data) ? data.map(normalizeRole) : [];
      return _cachedRoles;
    } catch {
      return _cachedRoles || [];
    }
  }

  function getRoles() {
    // Return cached roles synchronously; caller can await fetchRoles() for fresh data
    return _cachedRoles || [];
  }

  function getRole(roleId) {
    return getRoles().find((r) => r.id === roleId || r.key === roleId) || null;
  }

  async function saveRole(roleInput) {
    if (!window.CastingAPI) return roleInput;
    const API = window.CastingAPI.roles;

    try {
      let saved;
      if (roleInput.id) {
        saved = await API.update(roleInput.id, {
          name: roleInput.name,
          description: roleInput.description,
          isActive: roleInput.isActive,
        });
        if (Array.isArray(roleInput.permissions)) {
          await API.updatePermissions(roleInput.id, { permissionKeys: roleInput.permissions });
        }
      } else {
        const key = normalizeKey(roleInput.name);
        saved = await API.create({ key, name: roleInput.name, description: roleInput.description });
        if (Array.isArray(roleInput.permissions) && roleInput.permissions.length) {
          await API.updatePermissions(saved.id, { permissionKeys: roleInput.permissions });
        }
      }
      _cachedRoles = null; // invalidate cache
      await fetchRoles();
      window.dispatchEvent(new CustomEvent(rolesChangedEvent, { detail: {} }));
      return normalizeRole(saved);
    } catch (err) {
      throw err;
    }
  }

  function deleteRole(roleId) {
    // Soft-reject — backend controls deletion; return false to keep UI consistent
    return false;
  }

  // ─── Permission checking ──────────────────────────────────────────────────────
  function getEffectivePermissions(user) {
    if (!user || user.isActive === false) return [];

    // Backend supplies a flat permissions array on the user object
    if (Array.isArray(user.permissions) && user.permissions.length > 0) {
      return user.permissions;
    }

    // Fallback: derive from cached roles using assignedRoleIds
    const roleIds = getAssignedRoleIds(user);
    const matchedRoles = getRoles().filter((r) => r.isActive !== false && roleIds.includes(r.id));
    return uniqueArray(matchedRoles.flatMap((r) => r.permissions || []));
  }

  function can(user, action, resource = {}) {
    const resourceType = resource.type || resource.resourceType || "";
    const resourceId   = resource.id   || resource.resourceId   || "";

    if (resourceType === "module")  return hasModulePermission(user, resourceId, action);
    if (resourceType === "stage")   return hasStagePermission(user, resourceId, action);
    if (resourceType === "special") return hasPermission(user, normalizeSpecialPermission(resourceId || action));
    if (resourceType === "system")  return hasPermission(user, permissionTokens.system(resourceId, action));

    return hasPermission(user, normalizeSpecialPermission(action));
  }

  function hasModulePermission(user, moduleId, action = "view") {
    const moduleAction = normalizeModuleAction(action);
    if (moduleAction === "markRush") return hasPermission(user, "rush.mark");
    return hasPermission(user, permissionTokens.module(moduleId, moduleAction));
  }

  function hasStagePermission(user, stageId, action = "view") {
    if (!hasPermission(user, "castingProcess.view")) return false;
    return hasPermission(user, permissionTokens.stage(normalizeStageId(stageId), normalizeStageAction(action)));
  }

  function hasPermission(user, permission) {
    return getEffectivePermissions(user).includes(permission);
  }

  function getStageIdByKey(stageKey) { return normalizeStageId(stageKey); }

  // ─── Audit logging ────────────────────────────────────────────────────────────
  // Backend records the authoritative audit trail.
  // This stub dispatches a local event so UI listeners still work.
  function recordAuditLog(entry = {}) {
    const logEntry = {
      id: createId("audit"),
      userId:             (entry.user || currentUser)?.id || "unknown",
      username:           (entry.user || currentUser)?.username || (entry.user || currentUser)?.name || "Unknown",
      action:             String(entry.action || "").trim() || "Action",
      barcodeValue:       String(entry.barcodeValue || getAuditObjectBarcodeValue(entry.newValue) || getAuditObjectBarcodeValue(entry.oldValue) || "").trim(),
      isInHouseProduction:getAuditInHouseProductionValue(entry),
      module:             String(entry.module || "").trim(),
      stage:              String(entry.stage  || "").trim(),
      internalTreeNumber: String(entry.internalTreeNumber || "").trim(),
      oldValue:           formatAuditValue(entry.oldValue),
      newValue:           formatAuditValue(entry.newValue),
      notes:              String(entry.notes  || "").trim(),
      device:             String(entry.device || getDeviceInfo()).trim(),
      createdAt:          entry.createdAt || new Date().toISOString()
    };

    window.dispatchEvent(new CustomEvent(auditChangedEvent, { detail: { log: logEntry } }));
    return logEntry;
  }

  async function getAuditLogs(params) {
    if (!window.CastingAPI) return [];
    try {
      const data = await window.CastingAPI.auditLogs.list(params);
      return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    } catch { return []; }
  }

  // ─── Role normalization ───────────────────────────────────────────────────────
  function normalizeRole(role) {
    return {
      id:          String(role.id   || createId("role")).trim(),
      key:         String(role.key  || "").trim(),
      name:        String(role.name || "Untitled Role").trim(),
      description: String(role.description || "").trim(),
      isActive:    role.isActive !== false,
      permissions: uniqueArray(expandLegacyPermissions(
        Array.isArray(role.permissions)    ? role.permissions :
        Array.isArray(role.permissionKeys) ? role.permissionKeys : []
      )),
      system: Boolean(role.system)
    };
  }

  function expandLegacyPermissions(rawPermissions) {
    const permissions = rawPermissions.map(String).filter(Boolean);
    const next = [];
    const legacyModules = [], legacyStages = [], legacyActions = [];

    permissions.forEach((p) => {
      if (p.startsWith("module:"))  { legacyModules.push(p.split(":")[1]); return; }
      if (p.startsWith("stage:"))   { legacyStages.push(normalizeStageId(p.split(":")[1])); return; }
      if (p.startsWith("action:"))  { legacyActions.push(p.split(":")[1]); return; }
      if (p.startsWith("system:"))  { const [,r,a] = p.split(":"); next.push(permissionTokens.system(r,a)); return; }
      next.push(p);
    });

    legacyModules.forEach((m) => {
      next.push(permissionTokens.module(m, "view"));
      legacyActions.forEach((a) => {
        const ma = normalizeModuleAction(a);
        if (resources.moduleActions.some((x) => x.id === ma)) next.push(permissionTokens.module(m, ma));
      });
    });

    legacyStages.forEach((s) => {
      next.push(permissionTokens.stage(s, "view"));
      legacyActions.forEach((a) => {
        const sa = normalizeStageAction(a);
        if (resources.stageActions.some((x) => x.id === sa)) next.push(permissionTokens.stage(s, sa));
      });
    });

    legacyActions.forEach((a) => {
      const sp = normalizeSpecialPermission(a);
      if (resources.specialPermissions.some((x) => x.id === sp)) next.push(sp);
    });

    return uniqueArray(next);
  }

  // ─── Normalizers (identical to original for compatibility) ───────────────────
  function normalizeModuleAction(action) {
    const n = normalizeKey(action);
    const a = { exportcsv:"export", markrush:"markRush", printlabel:"print" };
    return a[n] || n || "view";
  }

  function normalizeStageAction(action) {
    const n = normalizeKey(action);
    const a = { openfocusedorder:"open", editfocusedform:"edit", submitstage:"submit",
                viewstage:"view", markdamaged:"markDamaged", viewdamagedtrees:"viewDamagedTrees" };
    return a[n] || n || "view";
  }

  function normalizeSpecialPermission(permissionId) {
    const n = normalizeKey(permissionId);
    const a = {
      assignroles:"roles.assign", auditlogsexport:"auditLogs.export",
      auditlogsview:"auditLogs.view", exportauditlogs:"auditLogs.export",
      exportinventoryledger:"inventoryLedger.export", inventoryadjustmentfuture:"inventory.adjustment.future",
      inventoryledgerexport:"inventoryLedger.export", inventoryledgerview:"inventoryLedger.view",
      inventorypostfinal:"inventory.postFinal", manageroles:"roles.manage",
      manageusers:"users.manage", markrush:"rush.mark",
      postfinalinventory:"inventory.postFinal", rolesassign:"roles.assign",
      rolesmanage:"roles.manage", rushmark:"rush.mark",
      usersmanage:"users.manage", viewauditlogs:"auditLogs.view",
      viewinventoryledger:"inventoryLedger.view"
    };
    if (String(permissionId || "").includes(".")) return String(permissionId).trim();
    return a[n] || n;
  }

  function normalizeSystemPermission(resourceId, action) {
    const r = normalizeKey(resourceId), a = normalizeKey(action);
    const map = {
      "roles:manage":"roles.manage", "users:manage":"users.manage",
      "roles:assign":"roles.assign", "auditlogs:view":"auditLogs.view",
      "auditlogs:export":"auditLogs.export", "inventoryledger:view":"inventoryLedger.view",
      "inventoryledger:export":"inventoryLedger.export", "inventory:postfinal":"inventory.postFinal",
      "inventory:adjustmentfuture":"inventory.adjustment.future"
    };
    return map[`${r}:${a}`] || `${resourceId}.${a}`;
  }

  function normalizeStageId(stageId) {
    const raw = String(stageId || "").trim();
    const n   = normalizeKey(raw);
    const match = resources.stages.find((s) =>
      normalizeKey(s.id) === n || normalizeKey(s.stageKey) === n || normalizeKey(s.label) === n
    );
    return match ? match.id : raw;
  }

  function normalizeKey(value) {
    return String(value || "").trim().replace(/[_\-\s]+/g,"").toLowerCase();
  }

  function getAssignedRoleIds(user) {
    return uniqueArray([...(user?.assignedRoleIds||[]), ...(user?.roleIds||[])]).map((id) =>
      id === "admin" ? "role_admin" : id
    );
  }

  // ─── Audit helpers ────────────────────────────────────────────────────────────
  function getAuditObjectBarcodeValue(value) {
    if (!value || typeof value !== "object") return "";
    return String(value.barcodeValue || value.relatedBarcodeValue || "").trim();
  }

  function getAuditInHouseProductionValue(entry = {}) {
    const v = getFirstBooleanValue(
      entry.isInHouseProduction,
      getAuditObjectInHouseProduction(entry.newValue),
      getAuditObjectInHouseProduction(entry.oldValue)
    );
    if (typeof v !== "boolean") return "";
    return v ? "Yes" : "No";
  }

  function getAuditObjectInHouseProduction(value) {
    if (!value || typeof value !== "object") return null;
    return typeof value.isInHouseProduction === "boolean" ? value.isInHouseProduction : null;
  }

  function getFirstBooleanValue() {
    return Array.from(arguments).find((v) => typeof v === "boolean");
  }

  function formatAuditValue(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────
  function createId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function uniqueArray(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function getDeviceInfo() {
    return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  }

  // ─── Expose ───────────────────────────────────────────────────────────────────
  window.ProductionRBAC = {
    auditChangedEvent,
    can,
    currentUser,
    deleteRole,
    fetchRoles,
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
    saveRole,
  };
})();
