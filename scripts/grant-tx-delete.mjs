// Grant TRANSACTIONS_DELETE to a specific user (by name substring).
//
// Wires a per-user PermissionOverride row that lets the target user delete
// transactions from /reconciliation regardless of their role.
//
// Usage:
//   node scripts/grant-tx-delete.mjs "Nouri"                # dry-run: show matches
//   node scripts/grant-tx-delete.mjs "Nouri" --apply        # allow  (create override)
//   node scripts/grant-tx-delete.mjs "Nouri" --revoke       # remove the override
//
// Requires DATABASE_URL in the environment.

import { PrismaClient } from '@prisma/client'

const PERMISSION_KEY = 'transactions.delete'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set. Export it (or use `dotenv -e .env -- node …`).')
  process.exit(1)
}

const query = process.argv[2]
const apply = process.argv.includes('--apply')
const revoke = process.argv.includes('--revoke')
if (!query) {
  console.error('Usage: node scripts/grant-tx-delete.mjs "<name>" [--apply|--revoke]')
  process.exit(1)
}

const prisma = new PrismaClient()

try {
  const matches = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { employeeCode: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, employeeCode: true },
    take: 20,
  })

  if (matches.length === 0) {
    console.error(`No active user matched "${query}".`)
    process.exit(2)
  }

  console.log(`Matched ${matches.length} active user(s) for "${query}":`)
  for (const u of matches) {
    console.log(`  - ${u.name}  [${u.role}]  ${u.employeeCode ?? '-'}`)
  }

  if (matches.length > 1 && (apply || revoke)) {
    console.error('Refusing to act on ambiguous match. Narrow the search or pass the exact name.')
    process.exit(3)
  }

  if (!apply && !revoke) {
    console.log('Dry-run. Re-run with --apply to grant or --revoke to remove.')
    process.exit(0)
  }

  const target = matches[0]

  if (revoke) {
    await prisma.permissionOverride
      .delete({ where: { userId_permissionKey: { userId: target.id, permissionKey: PERMISSION_KEY } } })
      .catch(() => null)
    console.log(`Revoked ${PERMISSION_KEY} from ${target.name}.`)
  } else {
    await prisma.permissionOverride.upsert({
      where: { userId_permissionKey: { userId: target.id, permissionKey: PERMISSION_KEY } },
      create: {
        userId: target.id,
        permissionKey: PERMISSION_KEY,
        isAllowed: true,
        reason: 'granted via scripts/grant-tx-delete.mjs',
      },
      update: { isAllowed: true, reason: 'granted via scripts/grant-tx-delete.mjs' },
    })
    console.log(`Granted ${PERMISSION_KEY} to ${target.name} (${target.role}).`)
  }
} catch (err) {
  console.error('ERROR:', err.message || err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
