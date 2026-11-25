import type { NextRequest } from 'next/server'

// Bearer-token gate for operator/automation endpoints (cron jobs, one-shot
// admin backfills, rescue uploads).
//
// Two secrets are accepted so Vercel Cron keeps working with the value it was
// configured with (CRON_SECRET) while operators can drive the same endpoints
// with a separately rotatable token (OPS_TOKEN). Both live only in the
// deployed environment — locally neither is set, so this returns false and the
// caller falls through to session auth.
//
// Callers MUST still fall back to a session + role check when this returns
// false; this helper only answers "is this a valid machine caller?".
export function isOpsBearer(req: NextRequest): boolean {
  return opsAuthMethod(req) !== null
}
export function opsAuthMethod(req: NextRequest): 'OPS_TOKEN' | 'CRON_SECRET' | null {
  const provided = req.headers.get('authorization')
  if (process.env.OPS_TOKEN && provided === `Bearer ${process.env.OPS_TOKEN}`) return 'OPS_TOKEN'
  if (process.env.CRON_SECRET && provided === `Bearer ${process.env.CRON_SECRET}`) return 'CRON_SECRET'
  return null
}
