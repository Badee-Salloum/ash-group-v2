import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    user: {
      findMany: vi.fn(),
    },
    coverageAssignment: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))

import { GET } from '@/app/api/coverage/route'

function request(path = '/api/coverage'): NextRequest {
  return { nextUrl: new URL(`http://localhost${path}`) } as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    userId: 'manager-1',
    email: 'manager@example.com',
    name: 'Branch Manager',
    role: 'MANAGER',
  })
  mocks.db.user.findMany.mockResolvedValue([])
  mocks.db.coverageAssignment.findMany.mockResolvedValue([])
})

describe('GET /api/coverage', () => {
  it('returns JSON 401 without a session and does not query the database', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mocks.db.user.findMany).not.toHaveBeenCalled()
    expect(mocks.db.coverageAssignment.findMany).not.toHaveBeenCalled()
  })

  it('lets a manager query all active EMPLOYEEs and resolves user, coverFor, and the date-only value', async () => {
    mocks.db.user.findMany
      .mockResolvedValueOnce([{ id: 'coverer-1' }, { id: 'coverer-2' }])
      .mockResolvedValueOnce([{ id: 'on-leave-1', name: 'On Leave Employee' }])
    mocks.db.coverageAssignment.findMany.mockResolvedValueOnce([{
      id: 'coverage-1',
      userId: 'coverer-1',
      date: new Date('2026-08-10T00:00:00.000Z'),
      startTime: '06:00',
      endTime: '10:00',
      originalShiftId: 'shift-1',
      coverForUserId: 'on-leave-1',
      user: {
        id: 'coverer-1',
        name: 'Covering Employee',
        employeeCode: 'EMP-0001',
      },
    }])

    const response = await GET(request('/api/coverage?from=2026-08-10&to=2026-08-16'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: [{
        id: 'coverage-1',
        userId: 'coverer-1',
        date: '2026-08-10',
        startTime: '06:00',
        endTime: '10:00',
        originalShiftId: 'shift-1',
        coverForUserId: 'on-leave-1',
        user: {
          id: 'coverer-1',
          name: 'Covering Employee',
          employeeCode: 'EMP-0001',
        },
        coverFor: { id: 'on-leave-1', name: 'On Leave Employee' },
      }],
    })

    const employeeScope = mocks.db.user.findMany.mock.calls[0]?.[0]
    expect(employeeScope).toEqual(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, role: 'EMPLOYEE' }),
      select: { id: true },
    }))
    expect(employeeScope.where).not.toHaveProperty('managerId')
    expect(mocks.db.coverageAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { in: ['coverer-1', 'coverer-2'] },
      }),
      include: {
        user: { select: { id: true, name: true, employeeCode: true } },
      },
    }))
    expect(mocks.db.user.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['on-leave-1'] } },
      select: { id: true, name: true },
    })
  })

  it('applies the inclusive from/to range to the date-only column', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
    })

    const response = await GET(request('/api/coverage?from=2026-08-10&to=2026-08-16'))

    expect(response.status).toBe(200)
    expect(mocks.db.coverageAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        date: {
          gte: new Date('2026-08-10T00:00:00.000Z'),
          lte: new Date('2026-08-16T00:00:00.000Z'),
        },
      },
    }))
  })

  it.each([
    ['/api/coverage?from=not-a-date&to=2026-08-16', 'an invalid date'],
    ['/api/coverage?from=2026-02-30&to=2026-03-02', 'an impossible calendar date'],
    ['/api/coverage?from=2026-08-17&to=2026-08-16', 'a reversed range'],
  ])('returns JSON 400 without querying the database for %s (%s)', async (path) => {
    const response = await GET(request(path))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mocks.db.user.findMany).not.toHaveBeenCalled()
    expect(mocks.db.coverageAssignment.findMany).not.toHaveBeenCalled()
  })

  it('converts a database failure into a JSON 500 response', async () => {
    mocks.getSession.mockResolvedValueOnce({
      userId: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
    })
    mocks.db.coverageAssignment.findMany.mockRejectedValueOnce(new Error('coverage database unavailable'))

    const response = await GET(request('/api/coverage?from=2026-08-10&to=2026-08-16'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String) }))
  })
})
