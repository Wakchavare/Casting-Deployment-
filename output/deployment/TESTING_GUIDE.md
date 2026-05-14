# Testing Guide — Casting Production Management

---

## Quick Smoke Test (After Deployment)

Run these checks immediately after `docker compose up -d`:

```bash
# 1. All containers healthy
docker compose ps

# 2. Backend health endpoint
curl -s https://api-casting.yourdomain.com/api/health | python3 -m json.tool

# 3. Frontend loads
curl -s -o /dev/null -w "%{http_code}" https://casting.yourdomain.com
# Expected: 200

# 4. HTTPS redirect works
curl -s -o /dev/null -w "%{http_code}" http://casting.yourdomain.com
# Expected: 301 or 302
```

---

## Auth API Tests

Replace `API` with your actual backend URL.

### Login — success
```bash
curl -s -X POST https://api-casting.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@yourdomain.com","password":"YourAdminPassword"}' \
  | python3 -m json.tool
# Expected: { accessToken, refreshToken, user: { id, email, roles, permissions } }
```

### Login — wrong password
```bash
curl -s -X POST https://api-casting.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@yourdomain.com","password":"wrongpassword"}' \
  | python3 -m json.tool
# Expected: 401 Unauthorized
```

### Get current user (authenticated)
```bash
# First get a token
TOKEN=$(curl -s -X POST https://api-casting.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@yourdomain.com","password":"YourAdminPassword"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s https://api-casting.yourdomain.com/api/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# Expected: user object with roles + permissions
```

### Access protected route — no token
```bash
curl -s https://api-casting.yourdomain.com/api/wax-entries
# Expected: 401 Unauthorized
```

---

## Wax Entries API Tests

```bash
# Set your token first (see above)

# List wax entries
curl -s https://api-casting.yourdomain.com/api/wax-entries \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Create a wax entry
curl -s -X POST https://api-casting.yourdomain.com/api/wax-entries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vendorCustomerName": "Test Customer",
    "date": "2024-01-15",
    "metalKt": "18KT",
    "color": "Yellow",
    "waxWeight": "15.5",
    "isRush": false
  }' | python3 -m json.tool
# Expected: wax entry with internalTreeNumber like "A-1"

# Note the id from the response, then update it
ENTRY_ID="<id from above>"

curl -s -X PATCH "https://api-casting.yourdomain.com/api/wax-entries/${ENTRY_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vendorCustomerName": "Updated Customer"}' \
  | python3 -m json.tool

# Delete it
curl -s -X DELETE "https://api-casting.yourdomain.com/api/wax-entries/${ENTRY_ID}" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"success":true}
```

---

## Internal Tree Number Generation Test

Verify the sequence generates correctly and never duplicates:

```bash
# Create 5 entries rapidly — all should get unique tree numbers
for i in {1..5}; do
  curl -s -X POST https://api-casting.yourdomain.com/api/wax-entries \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"vendorCustomerName\": \"Batch Test $i\", \"metalKt\": \"18KT\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('internalTreeNumber','ERROR'))"
done
# Expected: A-1, A-2, A-3, A-4, A-5 (or continuing from current sequence)
# All must be unique — no duplicates
```

---

## RBAC Permission Tests

### Test permission denial
```bash
# Create a test user with no permissions (via admin panel)
# Then get their token:
LIMITED_TOKEN=$(curl -s -X POST https://api-casting.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"limited@test.com","password":"TestPass123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Try to access wax entries — should fail
curl -s https://api-casting.yourdomain.com/api/wax-entries \
  -H "Authorization: Bearer $LIMITED_TOKEN"
# Expected: 403 Forbidden

# Try to create a user — should fail
curl -s -X POST https://api-casting.yourdomain.com/api/users \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hacker","email":"hacker@test.com","password":"pass","confirmPassword":"pass"}'
# Expected: 403 Forbidden
```

---

## Casting Workflow Tests

```bash
# Create a wax entry first, note the id
WAX_ID="<wax entry id>"

# Update workflow to Ready for Casting
curl -s -X PUT "https://api-casting.yourdomain.com/api/casting-workflow/by-wax-entry/${WAX_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stage": "Ready for Casting", "notes": "Test workflow"}' \
  | python3 -m json.tool

# List all workflows
curl -s https://api-casting.yourdomain.com/api/casting-workflow \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## Inventory Duplicate Prevention Test

```bash
# Post final inventory for a tree
curl -s -X POST https://api-casting.yourdomain.com/api/inventory-ledger \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "internalTreeNumber": "A-1",
    "entryType": "final_post",
    "metalKt": "18KT",
    "finishedWeight": "12.5"
  }' | python3 -m json.tool
# Expected: success

# Try to post again — should get 409 Conflict
curl -s -X POST https://api-casting.yourdomain.com/api/inventory-ledger \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "internalTreeNumber": "A-1",
    "entryType": "final_post",
    "metalKt": "18KT",
    "finishedWeight": "12.5"
  }' | python3 -m json.tool
# Expected: 409 Conflict "Final inventory already posted for tree A-1"
```

---

## Multi-User Shared Data Test

```bash
# As admin: create a wax entry
ENTRY=$(curl -s -X POST https://api-casting.yourdomain.com/api/wax-entries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vendorCustomerName":"Multi-User Test","metalKt":"18KT"}')
echo $ENTRY | python3 -m json.tool

# As second user: verify they can see it
curl -s https://api-casting.yourdomain.com/api/wax-entries \
  -H "Authorization: Bearer $SECOND_TOKEN" \
  | python3 -c "import sys,json; entries=json.load(sys.stdin); print(f'Entry count: {len(entries)}')"
# Expected: includes the entry just created
```

---

## Docker Health Check Tests

```bash
# All containers should be "healthy"
docker compose ps

# Backend health endpoint directly
docker exec casting_backend wget -qO- http://localhost:3000/api/health
# Expected: {"status":"ok","database":"connected","timestamp":"..."}

# Check logs for errors
docker compose logs casting-backend --tail=50
docker compose logs casting_postgres --tail=20
```

---

## Cache Clear Verification

This confirms the app does not depend on browser storage:

1. Log in to the app in Chrome
2. Open DevTools → Application → Clear site data (check all)
3. Reload the page
4. Log in again
5. **All wax entries, workflow state, roles must still be visible** — they come from the server

---

## Automated Test Script

Save as `/opt/casting/scripts/smoke-test.sh`:

```bash
#!/bin/bash
set -e
API="https://api-casting.yourdomain.com"
ADMIN_EMAIL="admin@yourdomain.com"
ADMIN_PASS="YourAdminPassword"

echo "=== Casting App Smoke Tests ==="

echo -n "1. Health check... "
HEALTH=$(curl -sf "${API}/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
[ "$HEALTH" = "ok" ] && echo "PASS" || { echo "FAIL"; exit 1; }

echo -n "2. Auth login... "
TOKEN=$(curl -sf -X POST "${API}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
[ -n "$TOKEN" ] && echo "PASS" || { echo "FAIL"; exit 1; }

echo -n "3. Wax entries accessible... "
COUNT=$(curl -sf "${API}/api/wax-entries" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "PASS (${COUNT} entries)"

echo -n "4. Unauth request blocked... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API}/api/wax-entries")
[ "$STATUS" = "401" ] && echo "PASS" || { echo "FAIL (got $STATUS)"; exit 1; }

echo ""
echo "=== All smoke tests passed ==="
```
