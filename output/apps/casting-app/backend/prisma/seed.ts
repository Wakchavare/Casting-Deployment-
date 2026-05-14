import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

type SeedPermission = {
  key: string;
  label: string;
  group: string;
  description?: string;
};

const modulePermissions: SeedPermission[] = [
  { key: 'waxEntries.view', label: 'View Wax Entries', group: 'Wax Entries' },
  { key: 'waxEntries.create', label: 'Create Wax Entries', group: 'Wax Entries' },
  { key: 'waxEntries.edit', label: 'Edit Wax Entries', group: 'Wax Entries' },
  { key: 'waxEntries.delete', label: 'Delete Wax Entries', group: 'Wax Entries' },
  { key: 'waxEntries.export', label: 'Export Wax Entries', group: 'Wax Entries' },
  { key: 'waxEntries.print', label: 'Print Wax Entries', group: 'Wax Entries' },
  { key: 'castingProcess.view', label: 'View Casting Process', group: 'Casting Process' },
  { key: 'castingProcess.create', label: 'Create Casting Process Records', group: 'Casting Process' },
  { key: 'castingProcess.edit', label: 'Edit Casting Process Records', group: 'Casting Process' },
  { key: 'castingProcess.delete', label: 'Delete Casting Process Records', group: 'Casting Process' },
  { key: 'castingProcess.export', label: 'Export Casting Process', group: 'Casting Process' },
  { key: 'castingProcess.print', label: 'Print Casting Process', group: 'Casting Process' },
  { key: 'metalReceiving.view', label: 'View Metal Receiving', group: 'Metal Receiving' },
  { key: 'metalReceiving.create', label: 'Create Metal Receiving', group: 'Metal Receiving' },
  { key: 'metalReceiving.edit', label: 'Edit Metal Receiving', group: 'Metal Receiving' },
  { key: 'metalReceiving.delete', label: 'Delete Metal Receiving', group: 'Metal Receiving' },
  { key: 'metalReceiving.export', label: 'Export Metal Receiving', group: 'Metal Receiving' },
  { key: 'metalReceiving.print', label: 'Print Metal Receiving', group: 'Metal Receiving' },
  { key: 'inventory.view', label: 'View Inventory', group: 'Inventory' },
  { key: 'inventoryLedger.view', label: 'View Inventory Ledger', group: 'Inventory' },
  { key: 'inventoryLedger.export', label: 'Export Inventory Ledger', group: 'Inventory' },
];

const stageDefinitions = [
  ['awaitingMetal', 'Awaiting Metal'],
  ['readyForCasting', 'Ready for Casting'],
  ['castingCompleted', 'Casting Completed'],
  ['qualityCheck', 'Quality Check and Control'],
  ['orderCompleted', 'Order Completed'],
] as const;

const stageActions = [
  ['view', 'View Stage'],
  ['open', 'Open Focused Order'],
  ['edit', 'Edit Focused Form'],
  ['submit', 'Submit Stage'],
  ['print', 'Print'],
  ['markDamaged', 'Mark Damaged'],
  ['viewDamagedTrees', 'View Damaged Trees'],
] as const;

const stagePermissions: SeedPermission[] = stageDefinitions.flatMap(([stageKey, stageLabel]) =>
  stageActions.map(([actionKey, actionLabel]) => ({
    key: `casting.${stageKey}.${actionKey}`,
    label: `${actionLabel}: ${stageLabel}`,
    group: `Casting Stage: ${stageLabel}`,
  })),
);

const specialPermissions: SeedPermission[] = [
  { key: 'roles.manage', label: 'Manage Roles', group: 'Administration' },
  { key: 'users.manage', label: 'Manage Users', group: 'Administration' },
  { key: 'roles.assign', label: 'Assign Roles', group: 'Administration' },
  { key: 'rush.mark', label: 'Mark Rush', group: 'Special Actions' },
  { key: 'auditLogs.view', label: 'View Audit Logs', group: 'Audit Logs' },
  { key: 'auditLogs.export', label: 'Export Audit Logs', group: 'Audit Logs' },
  { key: 'inventory.postFinal', label: 'Post Final Inventory', group: 'Inventory' },
  { key: 'inventory.adjustment.future', label: 'Future Inventory Adjustment', group: 'Inventory' },
  { key: 'damagedTrees.view', label: 'View Damaged Trees', group: 'Casting Process' },
  {
    key: 'casting.orderCompleted.viewSummary',
    label: 'View Order Completed Summary',
    group: 'Casting Stage: Order Completed',
  },
];

const permissions = [...modulePermissions, ...stagePermissions, ...specialPermissions];

async function main() {
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        label: permission.label,
        group: permission.group,
        description: permission.description,
      },
      create: permission,
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { key: 'role_admin' },
    update: {
      name: 'Admin',
      description: 'Full system access',
      isActive: true,
      system: true,
    },
    create: {
      key: 'role_admin',
      name: 'Admin',
      description: 'Full system access',
      isActive: true,
      system: true,
    },
  });

  const allPermissions = await prisma.permission.findMany({ select: { id: true } });

  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((permission) => ({
      roleId: adminRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? 'Admin@123';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: 'System Admin',
      username: adminEmail,
      passwordHash,
      isActive: true,
    },
    create: {
      name: 'System Admin',
      email: adminEmail,
      username: adminEmail,
      passwordHash,
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });

  await prisma.internalTreeSequence.upsert({
    where: { id: 'global' },
    update: {},
    create: { id: 'global' },
  });

  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      username: adminUser.username,
      action: 'Default admin seed completed',
      module: 'Backend Setup',
      notes: 'Development default admin and permissions were seeded.',
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
