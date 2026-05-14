# Security Notes — Casting Production Management

## localStorage / sessionStorage Usage Policy

### ✅ ALLOWED (non-sensitive UI state only)
| Key | Location | Content | Reason |
|-----|----------|---------|--------|
| `casting-rt` | `sessionStorage` | JWT refresh token (string) | Tab-scoped; cleared on tab close. Short-lived. No PII. |

### ❌ REMOVED (was present, now eliminated)
| Old Key | Was Stored | Replaced By |
|---------|-----------|-------------|
| `production-management-state-v1` | Wax entries (business data) | PostgreSQL via `/api/wax-entries` |
| `production-management-kanban-v1` | Casting workflow state | PostgreSQL via `/api/casting-workflow` |
| `production-management-metal-receiving-v1` | Metal receiving records | PostgreSQL via `/api/metal-receiving` |
| `production-management-inventory-ledger-v1` | Inventory ledger | PostgreSQL via `/api/inventory-ledger` |
| `production-management-users-v1` | User accounts + password hashes | PostgreSQL via `/api/users` |
| `production-management-session-v1` | Session data | PostgreSQL Sessions table |
| `production-management-rbac-v2` | Roles + permissions | PostgreSQL via `/api/roles` |
| `production-management-audit-v1` | Audit logs | PostgreSQL AuditLog table |

---

## JWT / Token Security

- **Access token** lives in JavaScript memory only (closure variable in `api-client.js`). Not in localStorage, not in a cookie.
- **Refresh token** lives in `sessionStorage` (tab-scoped, cleared on close).
- Access tokens expire in **15 minutes** by default (`JWT_EXPIRES_IN`).
- Refresh tokens expire in **7 days** by default (`REFRESH_TOKEN_DAYS`).
- All refresh tokens are **hashed with bcrypt** before storage in PostgreSQL.
- Token rotation: each `/auth/refresh` call revokes the old refresh token and issues a new one.
- Full session revocation on password change.

### What to change before production
```bash
# Generate a strong JWT secret (minimum 64 chars)
openssl rand -base64 64

# Put it in .env
JWT_SECRET=<output above>
```

---

## Secrets Checklist

Before going live, confirm ALL of these have been changed from defaults:

- [ ] `POSTGRES_PASSWORD` — not the example value
- [ ] `JWT_SECRET` — generated with `openssl rand -base64 64`
- [ ] `DEFAULT_ADMIN_PASSWORD` — changed on first login after seed
- [ ] `CORS_ORIGIN` — set to your actual domain only, not `*`

---

## Network Security

- PostgreSQL port **5432 is NOT exposed** to the host or internet. It's on an internal Docker network only.
- The NestJS backend port **3000 is NOT exposed** to the host. It's only reachable via Nginx Proxy Manager on the internal Docker network.
- Only ports **80**, **443**, and **81** (NPM admin) are exposed.
- **Immediately firewall port 81** after initial NPM setup, or restrict to your management IP only:
  ```bash
  ufw allow 80/tcp
  ufw allow 443/tcp
  # Only open 81 temporarily during setup, then close it
  ufw deny 81/tcp
  ```

---

## Hetzner VPS Firewall Recommendations

In the Hetzner Cloud console → your server → Firewalls:

| Direction | Protocol | Port | Source | Reason |
|-----------|----------|------|--------|--------|
| Inbound | TCP | 22 | Your IP only | SSH |
| Inbound | TCP | 80 | Any | HTTP (redirect) |
| Inbound | TCP | 443 | Any | HTTPS |
| Inbound | TCP | 81 | Your IP only | NPM admin (during setup) |
| All others | — | — | Deny | Default deny |

---

## Password Policy

Passwords are hashed with **bcrypt, 12 rounds** before storage. Plain text passwords are never stored or logged.

Minimum password requirements (enforced server-side):
- Minimum 8 characters
- Both current and new password required for change

---

## CORS

The backend `CORS_ORIGIN` env var must list **only your frontend domain**:
```
CORS_ORIGIN=https://casting.yourdomain.com
```
Never use `*` in production.

---

## Audit Logging

Every mutation (create/update/delete) on all business entities is recorded in the `AuditLog` table with:
- User ID + username
- IP address
- Action description
- Before/after values (JSON)
- Timestamp

Audit logs are **append-only** — there is no delete endpoint.

---

## Remaining Hardening (Future)

- [ ] Rate limiting on `/api/auth/login` (e.g., 5 attempts per minute per IP)
- [ ] HTTP-only cookie option for refresh token (alternative to sessionStorage)
- [ ] 2FA / TOTP for admin accounts
- [ ] Automated secret rotation
- [ ] Intrusion detection / fail2ban on SSH
