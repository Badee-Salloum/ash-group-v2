// One-off: lowercase any user emails that aren't already lower-case.
// Login now normalizes the lookup email; this brings legacy records into line
// so existing accounts don't lose access.
//
// Usage:
//   node scripts/lowercase-emails.mjs --check   # SELECT only (default)
//   node scripts/lowercase-emails.mjs --apply   # SELECT + UPDATE

import { PrismaClient } from '@prisma/client'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set. Export it before running.')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()

try {
  // Count-only — never print emails (PII) to the transcript.
  const [{ count }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count FROM users WHERE email <> LOWER(email)
  `
  if (count === 0) {
    console.log('OK 0 mixed-case rows. Nothing to do.')
    process.exit(0)
  }
  console.log(`Found ${count} mixed-case email row(s).`)

  if (!apply) {
    console.log('Dry run. Re-run with --apply to perform the update.')
    process.exit(0)
  }

  const result = await prisma.$executeRaw`
    UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email)
  `
  console.log(`Updated ${result} row(s).`)
} catch (err) {
  console.error('ERROR:', err.message || err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
