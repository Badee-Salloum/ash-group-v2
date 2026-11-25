import { describe, expect, it } from 'vitest'
import { signToken, verifyToken } from '@/lib/auth/token'

describe('edge-safe JWT helpers', () => {
  it('round-trips a valid session payload', async () => {
    const token = await signToken({
      userId: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      role: 'ADMIN',
    })

    await expect(verifyToken(token)).resolves.toMatchObject({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'ADMIN',
    })
  })

  it('rejects malformed tokens', async () => {
    await expect(verifyToken('not-a-jwt')).resolves.toBeNull()
  })
})
