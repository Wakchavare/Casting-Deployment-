# Backup & Restore — Casting Production Management

## Automated Daily Backup Script

Save this as `/opt/casting/scripts/backup.sh` on your VPS:

```bash
#!/bin/bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────
BACKUP_DIR="/opt/casting/backups"
COMPOSE_DIR="/opt/casting"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/casting_db_${DATE}.sql.gz"

# Load env vars
source "${COMPOSE_DIR}/.env"

# ── Create backup directory ────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── Dump database ─────────────────────────────────────────
echo "[$(date)] Starting backup..."

docker exec casting_postgres pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --no-password \
  --format=plain \
  --clean \
  --if-exists \
| gzip > "${BACKUP_FILE}"

echo "[$(date)] Backup saved: ${BACKUP_FILE}"
echo "[$(date)] Size: $(du -sh "${BACKUP_FILE}" | cut -f1)"

# ── Delete old backups ─────────────────────────────────────
find "${BACKUP_DIR}" -name "casting_db_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
echo "[$(date)] Cleaned backups older than ${RETENTION_DAYS} days"

echo "[$(date)] Backup complete."
```

Make it executable:
```bash
chmod +x /opt/casting/scripts/backup.sh
```

---

## Schedule Daily Backups with Cron

```bash
crontab -e
```

Add this line (runs every day at 2:00 AM):
```cron
0 2 * * * /opt/casting/scripts/backup.sh >> /var/log/casting-backup.log 2>&1
```

---

## Manual Backup (Run Anytime)

```bash
cd /opt/casting

# Quick manual backup
docker exec casting_postgres pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  | gzip > "/opt/casting/backups/manual_$(date +%Y%m%d_%H%M%S).sql.gz"
```

---

## Restore from Backup

> ⚠️ **Warning:** Restore will overwrite all current data. Make a fresh backup before restoring.

### Step 1 — Take a safety backup first
```bash
docker exec casting_postgres pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  | gzip > "/opt/casting/backups/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
```

### Step 2 — Stop the backend (prevent writes during restore)
```bash
cd /opt/casting
docker compose stop casting-backend
```

### Step 3 — Restore the backup
```bash
# Replace the filename with your backup file
BACKUP_FILE="/opt/casting/backups/casting_db_2024-01-15_02-00-00.sql.gz"

gunzip -c "${BACKUP_FILE}" | docker exec -i casting_postgres psql \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}"
```

### Step 4 — Restart the backend
```bash
docker compose start casting-backend
```

### Step 5 — Verify
```bash
# Check health endpoint
curl http://localhost:3000/api/health

# Check container status
docker compose ps
```

---

## Verify Backup Integrity

Test that your backup is not corrupt:
```bash
gunzip -t /opt/casting/backups/casting_db_YOURFILE.sql.gz && echo "OK — backup is valid"
```

---

## Off-Site Backup (Optional but Recommended)

Copy backups to another server or cloud storage. Example with `rclone` to S3:

```bash
# Install rclone
curl https://rclone.org/install.sh | bash

# Configure (follow prompts)
rclone config

# Sync backups folder
rclone sync /opt/casting/backups remote:your-bucket/casting-backups/
```

Or simple `scp` to another server:
```bash
scp /opt/casting/backups/casting_db_*.sql.gz user@backup-server:/backups/casting/
```

---

## Docker Volume Backup (Full State)

To back up the entire Postgres Docker volume (not just SQL):

```bash
# Stop postgres first for consistency
docker compose stop postgres

# Export volume to tar
docker run --rm \
  -v casting_postgres_data:/data \
  -v /opt/casting/backups:/backup \
  alpine tar czf /backup/volume_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# Restart
docker compose start postgres
```

Restore volume:
```bash
docker compose stop postgres

docker run --rm \
  -v casting_postgres_data:/data \
  -v /opt/casting/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/volume_YOURFILE.tar.gz -C /data"

docker compose start postgres
```

---

## Backup Directory Structure

```
/opt/casting/
├── backups/
│   ├── casting_db_2024-01-15_02-00-00.sql.gz   ← daily
│   ├── casting_db_2024-01-16_02-00-00.sql.gz
│   ├── manual_20240117_143022.sql.gz             ← manual
│   └── pre_restore_20240118_090000.sql.gz        ← pre-restore safety
└── scripts/
    └── backup.sh
```
