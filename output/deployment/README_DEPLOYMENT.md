# Deployment Guide — Casting Production Management
## Complete Beginner-Friendly Guide for Hetzner VPS (Ubuntu 24.04)

---

## Overview

This guide walks you through deploying the Casting Production Management app from scratch on a fresh Hetzner VPS. By the end you will have:

- A running PostgreSQL database
- A running NestJS backend API
- A running static frontend
- Nginx Proxy Manager handling SSL certificates and HTTPS
- Your app live at `https://casting.yourdomain.com`

**Architecture:**
```
Internet → Nginx Proxy Manager (ports 80/443)
               ├── casting.yourdomain.com     → Frontend container
               └── api-casting.yourdomain.com → Backend container
                                                    └── PostgreSQL (internal only)
```

---

## Step 1 — Buy a Hetzner VPS

1. Go to [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Click **Cloud** → **New project** → name it `casting`
3. Click **Add Server**
4. Choose:
   - **Location:** Closest to your users
   - **Image:** Ubuntu 24.04
   - **Type:** CX22 (2 vCPU, 4 GB RAM) — minimum recommended
   - **Networking:** Enable IPv4
   - **SSH Keys:** Add your public SSH key (see below if you don't have one)
5. Click **Create & Buy Now**
6. Note your server's **IP address** (e.g., `167.99.1.2`)

### Generate an SSH key (if you don't have one)
```bash
# On your LOCAL computer
ssh-keygen -t ed25519 -C "casting-deploy"
# Press Enter for all prompts
cat ~/.ssh/id_ed25519.pub
# Copy this output and paste it into Hetzner's SSH key field
```

---

## Step 2 — Connect to Your Server

```bash
# From your LOCAL computer
ssh root@YOUR_VPS_IP
```

You should see the Ubuntu welcome message.

---

## Step 3 — Basic Server Setup

```bash
# Update the system
apt update && apt upgrade -y

# Set your timezone (replace with yours)
timedatectl set-timezone America/New_York

# Create a deploy user (safer than using root)
adduser deploy
usermod -aG sudo deploy

# Copy SSH key to deploy user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

---

## Step 4 — Configure Firewall

```bash
# Enable UFW firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 81/tcp    # NPM admin — we'll close this after setup

ufw --force enable
ufw status
```

Expected output:
```
Status: active
To                Action  From
--                ------  ----
OpenSSH           ALLOW   Anywhere
80/tcp            ALLOW   Anywhere
443/tcp           ALLOW   Anywhere
81/tcp            ALLOW   Anywhere
```

---

## Step 5 — Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add deploy user to docker group
usermod -aG docker deploy

# Verify Docker works
docker --version
docker compose version
```

You should see version numbers for both.

---

## Step 6 — Upload the Project

Switch to your deploy user from here:
```bash
su - deploy
```

Create the project directory:
```bash
sudo mkdir -p /opt/casting
sudo chown deploy:deploy /opt/casting
```

**Option A — From your local computer (recommended):**
```bash
# On your LOCAL computer — compress and upload the project
tar -czf casting-app.tar.gz deployment/ apps/

scp casting-app.tar.gz deploy@YOUR_VPS_IP:/opt/casting/

# Back on the server
cd /opt/casting
tar -xzf casting-app.tar.gz
rm casting-app.tar.gz
```

**Option B — Clone from Git (if you have a repo):**
```bash
cd /opt/casting
git clone https://github.com/youruser/casting-app.git .
```

After upload, your directory should look like:
```
/opt/casting/
├── deployment/
│   ├── docker-compose.yml
│   ├── .env.example
│   └── ...
└── apps/
    └── casting-app/
        ├── frontend/
        └── backend/
```

---

## Step 7 — Create the Environment File

```bash
cd /opt/casting/deployment

# Copy the example file
cp .env.example .env

# Edit it with your actual values
nano .env
```

Fill in every value. Here's what each one means:

```bash
# Database credentials — make these strong and unique
POSTGRES_USER=casting_user
POSTGRES_PASSWORD=<make up a strong password, e.g. Xk9#mP2@vL8nQ4rJ>
POSTGRES_DB=casting_production

# JWT secret — MUST be random and at least 64 characters
# Generate one with: openssl rand -base64 64
JWT_SECRET=<paste the output of openssl rand -base64 64 here>

JWT_EXPIRES_IN=15m
REFRESH_TOKEN_DAYS=7

# Your domain (replace with your actual domain)
CORS_ORIGIN=https://casting.yourdomain.com

# Default admin account (used only for the first seed)
DEFAULT_ADMIN_EMAIL=admin@yourdomain.com
DEFAULT_ADMIN_PASSWORD=<a temporary password you'll change on first login>

PORT=3000
```

Save and close (`Ctrl+X`, then `Y`, then `Enter`).

Secure the file:
```bash
chmod 600 /opt/casting/deployment/.env
```

---

## Step 8 — Point DNS to Your Server

In your domain registrar (Namecheap, Cloudflare, GoDaddy, etc.):

Add two **A records**:

| Name | Type | Value | TTL |
|------|------|-------|-----|
| `casting` | A | `YOUR_VPS_IP` | 300 |
| `api-casting` | A | `YOUR_VPS_IP` | 300 |

This creates:
- `casting.yourdomain.com` → your server
- `api-casting.yourdomain.com` → your server

> DNS changes can take 5–60 minutes to propagate. You can check with:
> ```bash
> dig casting.yourdomain.com +short
> # Should return your VPS IP
> ```

---

## Step 9 — Build and Start the Containers

```bash
cd /opt/casting/deployment

# Build all Docker images (takes 3–8 minutes first time)
docker compose build

# Start everything in the background
docker compose up -d

# Watch the startup logs
docker compose logs -f --tail=50
```

Wait until you see the backend log something like:
```
casting_backend  | [Bootstrap] Application running on port 3000
```

Press `Ctrl+C` to stop watching logs (containers keep running).

Check all containers are healthy:
```bash
docker compose ps
```

All should show **healthy** within 60 seconds:
```
NAME                STATUS
casting_postgres    Up (healthy)
casting_backend     Up (healthy)
casting_frontend    Up (healthy)
casting_npm         Up (healthy)
```

---

## Step 10 — Run Database Migrations and Seed

```bash
cd /opt/casting/deployment

# Apply all database migrations (creates tables)
docker compose exec casting-backend npx prisma migrate deploy

# Seed the database (creates admin user + permissions)
docker compose exec casting-backend npx prisma db seed
```

You should see output like:
```
Running seed command `ts-node prisma/seed.ts` ...
Default admin seed completed
```

---

## Step 11 — Configure Nginx Proxy Manager

1. Open your browser and go to: `http://YOUR_VPS_IP:81`
2. Log in with the default credentials:
   - Email: `admin@example.com`
   - Password: `changeme`
3. **Immediately change the default password** when prompted.

### Create Proxy Host for Frontend

1. Click **Proxy Hosts** → **Add Proxy Host**
2. Fill in:
   - **Domain Names:** `casting.yourdomain.com`
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `casting_frontend`
   - **Forward Port:** `80`
   - Enable: **Block Common Exploits**
3. Click the **SSL** tab:
   - **SSL Certificate:** Request a New SSL Certificate
   - Enable: **Force SSL**
   - Enable: **HTTP/2 Support**
   - Enter your email for Let's Encrypt
   - Check: I Agree to the Let's Encrypt Terms
4. Click **Save**

### Create Proxy Host for Backend API

1. Click **Add Proxy Host** again
2. Fill in:
   - **Domain Names:** `api-casting.yourdomain.com`
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `casting_backend`
   - **Forward Port:** `3000`
   - Enable: **Block Common Exploits**
3. Click the **SSL** tab — same as above (Let's Encrypt, Force SSL)
4. Click **Save**

> ⚠️ Let's Encrypt requires your domain to be pointing at the server before it can issue a certificate. Make sure Step 8 (DNS) is done first.

---

## Step 12 — Close NPM Admin Port

Once proxy hosts are configured, close port 81:
```bash
sudo ufw deny 81/tcp
sudo ufw reload
```

To access NPM again in the future, temporarily re-open it from your IP:
```bash
sudo ufw allow from YOUR_HOME_IP to any port 81
```

---

## Step 13 — Verify Everything Works

```bash
# Backend health check
curl https://api-casting.yourdomain.com/api/health
# Expected: {"status":"ok","database":"connected","timestamp":"..."}

# Frontend loads
curl -s -o /dev/null -w "%{http_code}" https://casting.yourdomain.com
# Expected: 200
```

Open `https://casting.yourdomain.com` in your browser. You should see the login page.

Log in with:
- **Username:** the email you set in `DEFAULT_ADMIN_EMAIL`
- **Password:** the password you set in `DEFAULT_ADMIN_PASSWORD`

**Immediately change your admin password** (top right → Change Password).

---

## Step 14 — Set Up Automated Backups

```bash
# Create scripts directory
mkdir -p /opt/casting/scripts /opt/casting/backups

# Create backup script
cat > /opt/casting/scripts/backup.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/opt/casting/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
source /opt/casting/deployment/.env
mkdir -p "${BACKUP_DIR}"
docker exec casting_postgres pg_dump \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  | gzip > "${BACKUP_DIR}/casting_db_${DATE}.sql.gz"
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +30 -delete
echo "[$(date)] Backup complete: casting_db_${DATE}.sql.gz"
SCRIPT

chmod +x /opt/casting/scripts/backup.sh

# Test it
/opt/casting/scripts/backup.sh

# Schedule daily at 2 AM
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/casting/scripts/backup.sh >> /var/log/casting-backup.log 2>&1") | crontab -
```

---

## Day-to-Day Operations

### View logs
```bash
cd /opt/casting/deployment

# All services
docker compose logs -f

# Just backend
docker compose logs -f casting-backend

# Just database
docker compose logs -f postgres
```

### Restart a service
```bash
docker compose restart casting-backend
docker compose restart casting-frontend
```

### Restart everything
```bash
docker compose down && docker compose up -d
```

### Update the app (after uploading new files)
```bash
cd /opt/casting/deployment

# Rebuild and restart
docker compose build casting-backend casting-frontend
docker compose up -d casting-backend casting-frontend

# Apply any new database migrations
docker compose exec casting-backend npx prisma migrate deploy
```

### Check disk space
```bash
df -h
docker system df
```

### Clean up unused Docker images
```bash
docker system prune -f
```

---

## Troubleshooting

### Container won't start
```bash
docker compose logs casting-backend --tail=100
# Look for error messages
```

### Database connection failed
```bash
# Check postgres is healthy
docker compose ps postgres

# Check the DATABASE_URL in .env matches POSTGRES_* variables
cat /opt/casting/deployment/.env
```

### SSL certificate error
- Make sure DNS is pointing to your VPS (can take up to 1 hour)
- Check NPM logs: `docker compose logs casting_npm`
- Ensure ports 80 and 443 are open: `sudo ufw status`

### App shows old data / cache issues
```bash
# Restart frontend
docker compose restart casting-frontend

# Clear NPM proxy cache (in NPM admin UI: Proxy Hosts → Edit → Save)
```

### "Permission denied" errors
```bash
# Make sure deploy user owns the directory
sudo chown -R deploy:deploy /opt/casting
```

---

## Directory Reference

```
/opt/casting/
├── deployment/              ← docker-compose.yml, .env, docs
├── apps/
│   └── casting-app/
│       ├── frontend/        ← Static HTML/JS/CSS
│       └── backend/         ← NestJS source
├── backups/                 ← Database backup files
└── scripts/
    └── backup.sh            ← Automated backup script
```
