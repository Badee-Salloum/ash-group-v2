import { z } from 'zod'

const limits = ['25', '50', '100'] as const
export type DuplicateGroupLimit = 25 | 50 | 100

const querySchema = z.object({
  limit: z.enum(limits).optional().default('50'),
  cursor: z.string().min(1).max(512).optional(),
  accountId: z.string().trim().min(1).max(191).optional(),
})

export interface DuplicateGroupQuery {
  limit: DuplicateGroupLimit
  cursor?: string
  accountId?: string
}

export interface DuplicateGroupCursor {
  id: string
  lastSeenAt: string
}

export class InvalidDuplicateGroupCursorError extends Error {
  constructor() {
    super('Invalid duplicate-group cursor')
  }
}

export function parseDuplicateGroupQuery(params: URLSearchParams): DuplicateGroupQuery {
  const values = Object.fromEntries(params.entries())
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() === '') delete values[key]
  }
  const parsed = querySchema.parse(values)
  return {
    limit: Number(parsed.limit) as DuplicateGroupLimit,
    cursor: parsed.cursor,
    accountId: parsed.accountId,
  }
}

export function encodeDuplicateGroupCursor(cursor: DuplicateGroupCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeDuplicateGroupCursor(value: string): DuplicateGroupCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<DuplicateGroupCursor>
    const date = typeof decoded.lastSeenAt === 'string' ? new Date(decoded.lastSeenAt) : null
    if (!decoded || typeof decoded.id !== 'string' || !decoded.id || !date || Number.isNaN(date.getTime())) {
      throw new InvalidDuplicateGroupCursorError()
    }
    return { id: decoded.id, lastSeenAt: date.toISOString() }
  } catch {
    throw new InvalidDuplicateGroupCursorError()
  }
}

