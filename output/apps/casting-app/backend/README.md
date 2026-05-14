# Production Management Backend

NestJS + TypeScript backend foundation for the Production Management System.

This phase includes:

- PostgreSQL + Prisma setup
- Users, roles, permissions, user-role and role-permission tables
- Refresh-token persistence
- Authentication APIs
- RBAC APIs
- Permission guard
- Audit log foundation
- Default admin seed

This phase intentionally does not migrate Wax Entries, Casting Process, Metal Receiving, or Inventory workflows yet.

## Setup

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

On Windows PowerShell, use:

```powershell
cd backend
copy .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

Default development login:

- Email: `admin@example.com`
- Password: `Admin@123`

Change the default admin password before production use.

## Test Login

```bash
curl -X POST http://localhost:3000/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin@example.com\",\"password\":\"Admin@123\"}"
```

Use the returned `accessToken` for protected endpoints:

```bash
curl http://localhost:3000/auth/me ^
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## Implemented API Areas

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/change-password`
- `GET /users`
- `POST /users`
- `GET /users/:id`
- `PATCH /users/:id`
- `PUT /users/:id/roles`
- `POST /users/:id/reset-password`
- `PATCH /users/:id/deactivate`
- `GET /wax-entries`
- `POST /wax-entries`
- `PATCH /wax-entries/:id`
- `DELETE /wax-entries/:id`
- `GET /roles`
- `POST /roles`
- `GET /roles/:id`
- `PATCH /roles/:id`
- `PUT /roles/:id/permissions`
- `DELETE /roles/:id`
- `GET /permissions`
- `GET /audit-logs`
- `GET /audit-logs/export`

## Internal Tree Number Generation

Wax Entry creation uses backend-owned Internal Tree Number generation. The sequence is stored in PostgreSQL through Prisma in `InternalTreeSequence`, and each `WaxEntry.internalTreeNumber` has a unique database constraint.

Generation pattern:

- `A-1` through `A-150`
- `B-1` through `Z-150`
- `A1-1` through `Z1-150`
- `A2-1` and onward

Deleted Wax Entries do not decrement or free sequence numbers.
