(function () {
  "use strict";

  const RBAC = window.ProductionRBAC;

  if (!RBAC) {
    return;
  }

  const usersStorageKey = "production-management-users-v1";
  const sessionStorageKey = "production-management-session-v1";
  const usersChangedEvent = "productionAuthUsersChanged";
  const authChangedEvent = "productionAuthSessionChanged";
  const sessionDurationMs = 8 * 60 * 60 * 1000;
  const passwordIterations = 150000;
  const defaultAdminPassword = "Admin@123";

  const anonymousUser = {
    id: "anonymous",
    name: "Unauthenticated",
    username: "anonymous",
    email: "",
    assignedRoleIds: [],
    roleIds: [],
    isActive: false
  };

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function createDefaultAdminUser() {
    const now = new Date().toISOString();

    return {
      id: "user_admin",
      name: "System Admin",
      email: "admin@example.com",
      username: "admin@example.com",
      assignedRoleIds: ["role_admin"],
      roleIds: ["role_admin"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: "",
      passwordAlgorithm: "bootstrap-dev-admin",
      passwordHash: "",
      passwordSalt: "",
      passwordUpdatedAt: ""
    };
  }

  function readUserState() {
    const storedState = readJson(usersStorageKey);
    const users = storedState && Array.isArray(storedState.users) ? storedState.users : [];
    const normalizedUsers = users.map(normalizeStoredUser).filter((user) => user.id && user.email);
    const hasAdmin = normalizedUsers.some((user) => user.email === "admin@example.com");

    if (!hasAdmin) {
      normalizedUsers.unshift(createDefaultAdminUser());
      writeUserState({ users: normalizedUsers });
    }

    return { users: normalizedUsers };
  }

  function writeUserState(state) {
    localStorage.setItem(usersStorageKey, JSON.stringify({ users: state.users.map(normalizeStoredUser) }));
    window.dispatchEvent(new CustomEvent(usersChangedEvent, { detail: { users: getUsers() } }));
  }

  function normalizeStoredUser(user) {
    const email = normalizeEmail(user.email || user.username);
    const assignedRoleIds = uniqueArray([...(user.assignedRoleIds || []), ...(user.roleIds || [])]).map((roleId) =>
      roleId === "admin" ? "role_admin" : roleId
    );

    return {
      id: String(user.id || createId("user")),
      name: String(user.name || user.fullName || "").trim(),
      email,
      username: email,
      assignedRoleIds,
      roleIds: assignedRoleIds,
      isActive: user.isActive !== false,
      createdAt: String(user.createdAt || new Date().toISOString()),
      updatedAt: String(user.updatedAt || ""),
      lastLoginAt: String(user.lastLoginAt || ""),
      passwordAlgorithm: String(user.passwordAlgorithm || ""),
      passwordHash: String(user.passwordHash || ""),
      passwordSalt: String(user.passwordSalt || ""),
      passwordUpdatedAt: String(user.passwordUpdatedAt || "")
    };
  }

  function sanitizeUser(user) {
    if (!user) return null;

    const assignedRoleIds = uniqueArray([...(user.assignedRoleIds || []), ...(user.roleIds || [])]).map((roleId) =>
      roleId === "admin" ? "role_admin" : roleId
    );

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username || user.email,
      assignedRoleIds,
      roleIds: assignedRoleIds,
      isActive: user.isActive !== false,
      createdAt: user.createdAt || "",
      updatedAt: user.updatedAt || "",
      lastLoginAt: user.lastLoginAt || ""
    };
  }

  function sanitizeUserForAudit(user) {
    const safeUser = sanitizeUser(user);
    if (!safeUser) return "";

    return safeUser;
  }

  function getUsers() {
    return readUserState().users.map(sanitizeUser);
  }

  function getUser(userId) {
    const user = readUserState().users.find((item) => item.id === userId);
    return sanitizeUser(user);
  }

  function getStoredUser(userId) {
    return readUserState().users.find((item) => item.id === userId) || null;
  }

  function getStoredUserByLogin(login) {
    const normalizedLogin = normalizeEmail(login);
    return readUserState().users.find((user) => user.email === normalizedLogin || user.username === normalizedLogin) || null;
  }

  function getCurrentUser() {
    return sanitizeUser(RBAC.currentUser);
  }

  function setCurrentUser(user) {
    Object.keys(RBAC.currentUser).forEach((key) => {
      delete RBAC.currentUser[key];
    });

    Object.assign(RBAC.currentUser, sanitizeUser(user) || anonymousUser);
  }

  function isAuthenticated() {
    const user = getCurrentUser();
    return Boolean(user && user.id && user.id !== "anonymous" && user.isActive);
  }

  async function login(username, password) {
    const loginValue = normalizeEmail(username);

    if (!loginValue || !password) {
      return { ok: false, error: "Invalid username or password" };
    }

    const user = getStoredUserByLogin(loginValue);

    if (!user) {
      recordAuthAudit("Failed login attempt", {
        user: { id: "unknown", username: loginValue, name: loginValue },
        newValue: "Invalid username or password"
      });
      return { ok: false, error: "Invalid username or password" };
    }

    if (!user.isActive) {
      recordAuthAudit("Failed login attempt", {
        user,
        newValue: "Inactive account"
      });
      return { ok: false, error: "Your account is inactive. Please contact Admin." };
    }

    const isValidPassword = await verifyPassword(user, password);
    if (!isValidPassword) {
      recordAuthAudit("Failed login attempt", {
        user,
        newValue: "Invalid username or password"
      });
      return { ok: false, error: "Invalid username or password" };
    }

    const now = new Date().toISOString();
    const state = readUserState();
    const userIndex = state.users.findIndex((item) => item.id === user.id);
    let sessionUser = user;

    if (userIndex !== -1) {
      sessionUser = {
        ...state.users[userIndex],
        lastLoginAt: now,
        updatedAt: now
      };

      if (sessionUser.passwordAlgorithm === "bootstrap-dev-admin") {
        sessionUser = {
          ...sessionUser,
          ...(await createPasswordRecord(password))
        };
      }

      state.users[userIndex] = sessionUser;
      writeUserState(state);
    }

    const session = createSession(sessionUser);
    setCurrentUser(sessionUser);
    recordAuthAudit("User logged in", {
      user: sessionUser,
      newValue: { sessionExpiresAt: session.expiresAt }
    });
    dispatchAuthChanged();

    return { ok: true, user: sanitizeUser(sessionUser), session };
  }

  function logout(options = {}) {
    const user = getCurrentUser();
    if (isAuthenticated()) {
      recordAuthAudit(options.reason === "Session expired" ? "User session expired" : "User logged out", {
        user,
        oldValue: { userId: user.id },
        notes: options.reason || ""
      });
    }

    localStorage.removeItem(sessionStorageKey);
    setCurrentUser(null);
    dispatchAuthChanged();
  }

  function createSession(user) {
    const session = {
      token: createId("session"),
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionDurationMs).toISOString()
    };

    localStorage.setItem(sessionStorageKey, JSON.stringify(session));
    return session;
  }

  function getSession() {
    const session = readJson(sessionStorageKey);
    if (!session || !session.userId || !session.expiresAt) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(sessionStorageKey);
      setCurrentUser(null);
      return null;
    }

    return session;
  }

  function hydrateSession() {
    const session = getSession();
    if (!session) {
      setCurrentUser(null);
      return null;
    }

    const user = getStoredUser(session.userId);
    if (!user || !user.isActive) {
      localStorage.removeItem(sessionStorageKey);
      setCurrentUser(null);
      return null;
    }

    setCurrentUser(user);
    return sanitizeUser(user);
  }

  async function saveUser(userInput = {}) {
    const state = readUserState();
    const email = normalizeEmail(userInput.email || userInput.username);
    const existingIndex = userInput.id ? state.users.findIndex((user) => user.id === userInput.id) : -1;
    const existingUser = existingIndex === -1 ? null : state.users[existingIndex];
    const isCreating = !existingUser;
    const password = String(userInput.password || "");
    const confirmPassword = String(userInput.confirmPassword || "");
    const passwordIsProvided = Boolean(password || confirmPassword);
    const now = new Date().toISOString();

    if (!String(userInput.name || "").trim()) {
      throw new Error("Full Name is required.");
    }

    if (!email) {
      throw new Error("Email / Username is required.");
    }

    const duplicateUser = state.users.find((user) => user.email === email && user.id !== userInput.id);
    if (duplicateUser) {
      throw new Error("A user with this email already exists.");
    }

    if (isCreating || passwordIsProvided) {
      const passwordErrors = validatePassword(password, confirmPassword, true);
      if (passwordErrors.length) {
        throw new Error(passwordErrors[0]);
      }
    }

    const assignedRoleIds = uniqueArray(userInput.assignedRoleIds || userInput.roleIds || []);
    let nextUser = {
      ...(existingUser || {}),
      id: existingUser?.id || createId("user"),
      name: String(userInput.name || "").trim(),
      email,
      username: email,
      assignedRoleIds,
      roleIds: assignedRoleIds,
      isActive: userInput.isActive !== false,
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
      lastLoginAt: existingUser?.lastLoginAt || ""
    };

    let passwordChanged = false;
    if (isCreating || passwordIsProvided) {
      nextUser = {
        ...nextUser,
        ...(await createPasswordRecord(password))
      };
      passwordChanged = true;
    }

    if (isCreating) {
      state.users.unshift(nextUser);
    } else {
      state.users[existingIndex] = nextUser;
    }

    writeUserState(state);
    hydrateSession();

    return {
      created: isCreating,
      passwordChanged,
      previousUser: sanitizeUser(existingUser),
      user: sanitizeUser(nextUser)
    };
  }

  function deactivateUser(userId) {
    const state = readUserState();
    const userIndex = state.users.findIndex((user) => user.id === userId);
    if (userIndex === -1) return null;

    const previousUser = sanitizeUser(state.users[userIndex]);
    state.users[userIndex] = {
      ...state.users[userIndex],
      isActive: false,
      updatedAt: new Date().toISOString()
    };
    writeUserState(state);

    if (RBAC.currentUser.id === userId) {
      logout({ reason: "Account deactivated" });
    } else {
      hydrateSession();
    }

    return {
      previousUser,
      user: sanitizeUser(state.users[userIndex])
    };
  }

  async function resetPassword(userId, password, confirmPassword) {
    const passwordErrors = validatePassword(password, confirmPassword, true);
    if (passwordErrors.length) {
      throw new Error(passwordErrors[0]);
    }

    const state = readUserState();
    const userIndex = state.users.findIndex((user) => user.id === userId);
    if (userIndex === -1) {
      throw new Error("User not found.");
    }

    const previousUser = sanitizeUser(state.users[userIndex]);
    state.users[userIndex] = {
      ...state.users[userIndex],
      ...(await createPasswordRecord(password)),
      updatedAt: new Date().toISOString()
    };
    writeUserState(state);

    return {
      previousUser,
      user: sanitizeUser(state.users[userIndex])
    };
  }

  function validatePassword(password, confirmPassword, required = true) {
    const value = String(password || "");
    const confirmation = String(confirmPassword || "");
    const messages = [];

    if (!value && !confirmation && !required) {
      return messages;
    }

    if (!value) messages.push("Password is required.");
    if (value.length < 8) messages.push("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(value)) messages.push("Password must include at least 1 uppercase letter.");
    if (!/[a-z]/.test(value)) messages.push("Password must include at least 1 lowercase letter.");
    if (!/[0-9]/.test(value)) messages.push("Password must include at least 1 number.");
    if (!/[^A-Za-z0-9]/.test(value)) messages.push("Password must include at least 1 special character.");
    if (value !== confirmation) messages.push("Confirm password must match.");

    return messages;
  }

  async function createPasswordRecord(password) {
    const salt = createRandomBase64(16);

    return {
      passwordAlgorithm: "PBKDF2-SHA256",
      passwordHash: await hashPassword(password, salt),
      passwordSalt: salt,
      passwordUpdatedAt: new Date().toISOString()
    };
  }

  async function verifyPassword(user, password) {
    if (user.passwordAlgorithm === "bootstrap-dev-admin") {
      return user.email === "admin@example.com" && password === defaultAdminPassword;
    }

    if (!user.passwordHash || !user.passwordSalt) {
      return false;
    }

    const passwordHash = await hashPassword(password, user.passwordSalt);
    return constantTimeEqual(passwordHash, user.passwordHash);
  }

  async function hashPassword(password, salt) {
    if (!window.crypto?.subtle || !window.TextEncoder) {
      return fallbackHash(password, salt);
    }

    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
      "deriveBits"
    ]);
    const hashBuffer = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: base64ToBytes(salt),
        iterations: passwordIterations,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

    return bytesToBase64(new Uint8Array(hashBuffer));
  }

  function fallbackHash(password, salt) {
    let hash = 2166136261;
    const input = `${salt}:${password}`;

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return `fallback-${Math.abs(hash >>> 0).toString(16)}`;
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;

    let result = 0;
    for (let index = 0; index < left.length; index += 1) {
      result |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }

    return result === 0;
  }

  function recordAuthAudit(action, details = {}) {
    RBAC.recordAuditLog({
      action,
      module: "Authentication",
      user: details.user || getCurrentUser() || anonymousUser,
      oldValue: details.oldValue || "",
      newValue: details.newValue || "",
      notes: details.notes || "",
      device: getDeviceInfo()
    });
  }

  function dispatchAuthChanged() {
    window.dispatchEvent(
      new CustomEvent(authChangedEvent, {
        detail: {
          user: getCurrentUser(),
          session: getSession()
        }
      })
    );
  }

  function createRandomBase64(length) {
    const bytes = new Uint8Array(length);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }

    return bytesToBase64(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function uniqueArray(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function getDeviceInfo() {
    return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  }

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
    validatePassword
  });
})();
