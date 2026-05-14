-- CreateTable: User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Role
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Permission
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UserRole
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable: RolePermission
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable: Session
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RefreshToken
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT,
    "stage" TEXT,
    "internalTreeNumber" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "notes" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InternalTreeSequence
CREATE TABLE "InternalTreeSequence" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "currentPrefix" TEXT NOT NULL DEFAULT 'A',
    "currentAlphabetIndex" INTEGER NOT NULL DEFAULT 0,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "currentCycle" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InternalTreeSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WaxEntry
CREATE TABLE "WaxEntry" (
    "id" TEXT NOT NULL,
    "internalTreeNumber" TEXT NOT NULL,
    "internalTreePrefix" TEXT NOT NULL,
    "internalTreeSequence" INTEGER NOT NULL,
    "internalTreeCycle" INTEGER NOT NULL DEFAULT 0,
    "vendorCustomerName" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3),
    "waxInvoiceNo" TEXT NOT NULL DEFAULT '',
    "customerVendorTreeNo" TEXT NOT NULL DEFAULT '',
    "metalKt" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "waxWeight" DECIMAL(12,3),
    "isRush" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "updatedByUserId" TEXT,
    "updatedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "WaxEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CastingWorkflow
CREATE TABLE "CastingWorkflow" (
    "id" TEXT NOT NULL,
    "waxEntryId" TEXT NOT NULL,
    "internalTreeNumber" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Awaiting Metal',
    "notes" TEXT NOT NULL DEFAULT '',
    "metalIssue" JSONB,
    "castingIssue" JSONB,
    "castingVerification" JSONB,
    "qcVerification" JSONB,
    "finalOrderPosted" BOOLEAN NOT NULL DEFAULT false,
    "finalStatus" TEXT,
    "removedFromBoard" BOOLEAN NOT NULL DEFAULT false,
    "isDamaged" BOOLEAN NOT NULL DEFAULT false,
    "damagedTree" JSONB,
    "inventoryLedgerIds" JSONB,
    "updatedByUserId" TEXT,
    "updatedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CastingWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MetalReceiving
CREATE TABLE "MetalReceiving" (
    "id" TEXT NOT NULL,
    "receivingDate" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT '',
    "invoiceNo" TEXT NOT NULL DEFAULT '',
    "metalKt" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "metalSource" TEXT NOT NULL DEFAULT '',
    "grossWeight" DECIMAL(12,3),
    "netWeight" DECIMAL(12,3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdByUserId" TEXT,
    "createdByUsername" TEXT,
    "updatedByUserId" TEXT,
    "updatedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MetalReceiving_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryLedger
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "internalTreeNumber" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "metalKt" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "metalSource" TEXT NOT NULL DEFAULT '',
    "fineGoldWeight" DECIMAL(12,3),
    "alloyWeight" DECIMAL(12,3),
    "recycledWeight" DECIMAL(12,3),
    "issuedWeight" DECIMAL(12,3),
    "returnedWeight" DECIMAL(12,3),
    "finishedWeight" DECIMAL(12,3),
    "spruWeight" DECIMAL(12,3),
    "scrapWeight" DECIMAL(12,3),
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "postedByUserId" TEXT,
    "postedByUsername" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',
    "rawPayload" JSONB,
    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE UNIQUE INDEX "WaxEntry_internalTreeNumber_key" ON "WaxEntry"("internalTreeNumber");
CREATE UNIQUE INDEX "CastingWorkflow_waxEntryId_key" ON "CastingWorkflow"("waxEntryId");
CREATE UNIQUE INDEX "CastingWorkflow_internalTreeNumber_key" ON "CastingWorkflow"("internalTreeNumber");

-- Indexes
CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE INDEX "Role_isActive_idx" ON "Role"("isActive");
CREATE INDEX "Permission_group_idx" ON "Permission"("group");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");
CREATE INDEX "AuditLog_stage_idx" ON "AuditLog"("stage");
CREATE INDEX "AuditLog_internalTreeNumber_idx" ON "AuditLog"("internalTreeNumber");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "WaxEntry_internalTreePrefix_internalTreeSequence_idx" ON "WaxEntry"("internalTreePrefix", "internalTreeSequence");
CREATE INDEX "WaxEntry_deletedAt_idx" ON "WaxEntry"("deletedAt");
CREATE INDEX "WaxEntry_createdAt_idx" ON "WaxEntry"("createdAt");
CREATE INDEX "CastingWorkflow_stage_idx" ON "CastingWorkflow"("stage");
CREATE INDEX "CastingWorkflow_isDamaged_idx" ON "CastingWorkflow"("isDamaged");
CREATE INDEX "CastingWorkflow_finalOrderPosted_idx" ON "CastingWorkflow"("finalOrderPosted");
CREATE INDEX "CastingWorkflow_createdAt_idx" ON "CastingWorkflow"("createdAt");
CREATE INDEX "MetalReceiving_receivingDate_idx" ON "MetalReceiving"("receivingDate");
CREATE INDEX "MetalReceiving_deletedAt_idx" ON "MetalReceiving"("deletedAt");
CREATE INDEX "InventoryLedger_internalTreeNumber_idx" ON "InventoryLedger"("internalTreeNumber");
CREATE INDEX "InventoryLedger_entryType_idx" ON "InventoryLedger"("entryType");
CREATE INDEX "InventoryLedger_postedAt_idx" ON "InventoryLedger"("postedAt");

-- Foreign keys
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CastingWorkflow" ADD CONSTRAINT "CastingWorkflow_waxEntryId_fkey" FOREIGN KEY ("waxEntryId") REFERENCES "WaxEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
