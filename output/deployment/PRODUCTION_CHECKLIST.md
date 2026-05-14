# Production Checklist — Casting Production Management

Work through this list **top to bottom** before going live.  
Check each item off as you complete it.

---

## 1. Server Setup

- [ ] Hetzner VPS purchased (CX22 or higher recommended)
- [ ] Ubuntu 24.04 LTS installed
- [ ] Root password changed
- [ ] Non-root user created with `sudo` access
- [ ] SSH key-based login configured
- [ ] Password-based SSH login disabled (`PasswordAuthentication no` in `/etc/ssh/sshd_config`)
- [ ] UFW firewall enabled
- [ ] Only ports 22 (your IP), 80, 443 open. Port 81 only during NPM setup.
- [ ] Docker and Docker Compose installed
- [ ] Server time/timezone set correctly (`timedatectl set-timezone Your/Timezone`)

---

## 2. Project Files

- [ ] Project uploaded to `/opt/casting/` on VPS
- [ ] `.env` file created from `.env.example`
- [ ] All secrets in `.env` changed from example values
- [ ] `.env` file permissions set to `600`: `chmod 600 /opt/casting/.env`
- [ ] `.env` is NOT committed to version control (check `.gitignore`)

---

## 3. Secrets (CRITICAL)

- [ ] `POSTGRES_PASSWORD` — strong, unique, not the example value
- [ ] `JWT_SECRET` — generated with `openssl rand -base64 64` (min 64 chars)
- [ ] `DEFAULT_ADMIN_PASSWORD` — a real password; will be changed on first login
- [ ] `CORS_ORIGIN` — set to your actual domain (e.g., `https://casting.yourdomain.com`)

---

## 4. Docker Build & Start

- [ ] `docker compose build` runs without errors
- [ ] `docker compose up -d` starts all containers
- [ ] All containers show as healthy: `docker compose ps`
  - `casting_postgres` → healthy
  - `casting_backend` → healthy
  - `casting_frontend` → healthy
  - `casting_npm` → healthy

---

## 5. Database

- [ ] Prisma migration applied: `docker compose exec casting-backend npx prisma migrate deploy`
- [ ] Database seeded: `docker compose exec casting-backend npx prisma db seed`
- [ ] Seed completed without errors (check logs)
- [ ] Admin user exists (test login with `DEFAULT_ADMIN_EMAIL` + `DEFAULT_ADMIN_PASSWORD`)
- [ ] Postgres NOT reachable from outside: `nc -zv YOUR_VPS_IP 5432` should time out

---

## 6. Nginx Proxy Manager

- [ ] NPM admin accessible at `http://YOUR_VPS_IP:81`
- [ ] NPM default admin password changed (default: `changeme`)
- [ ] Proxy Host created for **Frontend**: `casting.yourdomain.com` → `http://casting_frontend:80`
- [ ] Proxy Host created for **Backend API**: `api-casting.yourdomain.com` → `http://casting_backend:3000`
- [ ] SSL certificate issued for both domains via Let's Encrypt
- [ ] Force HTTPS enabled on both proxy hosts
- [ ] NPM admin port 81 firewalled after setup: `ufw deny 81/tcp`

---

## 7. DNS

- [ ] DNS A record for `casting.yourdomain.com` → VPS IP
- [ ] DNS A record for `api-casting.yourdomain.com` → VPS IP
- [ ] DNS propagated (test: `dig casting.yourdomain.com`)

---

## 8. Application Health

- [ ] Health endpoint returns OK: `curl https://api-casting.yourdomain.com/api/health`
- [ ] Frontend loads at `https://casting.yourdomain.com`
- [ ] Login works with admin credentials
- [ ] HTTPS redirect works (HTTP → HTTPS)
- [ ] Browser console has no critical errors

---

## 9. No localStorage Business Data

- [ ] Open browser DevTools → Application → Local Storage
- [ ] Confirm NONE of the following keys exist after login:
  - `production-management-state-v1`
  - `production-management-kanban-v1`
  - `production-management-users-v1`
  - `production-management-rbac-v2`
  - `production-management-audit-v1`
  - `production-management-metal-receiving-v1`
  - `production-management-inventory-ledger-v1`
- [ ] Only `casting-rt` in sessionStorage is acceptable (refresh token)
- [ ] Clear browser cache, reload — app still works (data comes from server)

---

## 10. Multi-User Test

- [ ] Create a second user in the admin panel
- [ ] Log in as second user in a different browser/incognito window
- [ ] Create a wax entry as User A — confirm User B sees it immediately after refresh
- [ ] Advance a kanban stage as User A — confirm User B sees updated stage

---

## 11. Backups

- [ ] Backup script created at `/opt/casting/scripts/backup.sh`
- [ ] Backup script is executable: `chmod +x /opt/casting/scripts/backup.sh`
- [ ] Manual backup runs without error: `bash /opt/casting/scripts/backup.sh`
- [ ] Backup file exists and is non-zero in `/opt/casting/backups/`
- [ ] Backup integrity verified: `gunzip -t /opt/casting/backups/YOURFILE.sql.gz`
- [ ] Cron job scheduled for daily backups
- [ ] Restore process tested at least once on a staging environment

---

## 12. Monitoring (Optional but Recommended)

- [ ] Log rotation configured for Docker logs
- [ ] Container restart policy is `unless-stopped` (already set in docker-compose.yml)
- [ ] Uptime monitoring set up (e.g., UptimeRobot pinging `/api/health`)
- [ ] Email or Slack alert on downtime

---

## 13. First Login Hardening

- [ ] Log in as admin with default credentials
- [ ] **Immediately change the admin password** (Admin → Change Password)
- [ ] Create named user accounts for each real user (don't share the admin account)
- [ ] Assign appropriate roles to each user
- [ ] Optionally deactivate the generic admin account and use a named admin

---

## Sign-Off

| Item | Date | Verified By |
|------|------|-------------|
| Secrets changed | | |
| SSL active | | |
| Health checks passing | | |
| No localStorage business data | | |
| Backups tested | | |
| Multi-user test passed | | |
