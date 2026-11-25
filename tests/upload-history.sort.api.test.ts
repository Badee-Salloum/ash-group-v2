import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), access: vi.fn(), origins: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session, audit: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { auditLog: { findMany: mocks.origins }, uploadBatch: { findMany: mocks.findMany, count: mocks.count }, transaction: { groupBy: mocks.groupBy }, accountAccess: { findMany: mocks.access } } }))
import { GET } from '@/app/api/upload-batches/route'
const request = (query: string) => ({ url: `http://localhost/api/upload-batches?${query}` }) as NextRequest
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'ADMIN' })
  mocks.findMany.mockResolvedValue([])
  mocks.count.mockResolvedValue(1857)
  mocks.groupBy.mockResolvedValue([])
  mocks.origins.mockResolvedValue([])
})
describe('upload-history server sorting', () => {
  it('labels a failed machine upload as service, not the ADMIN used only for its legacy FK', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'batch', account: { name: 'account' }, uploader: { name: 'First admin' },
      createdAt: new Date(), batchDate: new Date(), status: 'FAILED', rowsProcessed: 0 }])
    mocks.origins.mockResolvedValue([{ action: 'UPLOAD_ATTEMPT', entityId: 'attempt',
      details: { batchId: 'batch', actorType: 'SERVICE', actorUserId: null, authMethod: 'OPS_TOKEN' } }])
    const response = await GET(request(''))
    const row = (await response.json()).data[0]
    expect(row).toMatchObject({ actorType: 'SERVICE', authMethod: 'OPS_TOKEN' })
    expect(row.uploaderName).not.toContain('First admin')
  })
  it('sorts all batches before applying page bounds and keeps results private', async () => {
    const response = await GET(request('sortBy=rowsProcessed&sortDir=desc&page=2&pageSize=25'))
    expect(response.status).toBe(200)
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ rowsProcessed: 'desc' }, { id: 'desc' }], skip: 25, take: 25 })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('keeps account-manager authorization under relation sorting', async () => {
    mocks.session.mockResolvedValue({ userId: 'manager', role: 'ACCOUNT_MGR' })
    mocks.access.mockResolvedValue([{ accountId: 'allowed' }])
    await GET(request('sortBy=accountName&sortDir=asc'))
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ where: { accountId: { in: ['allowed'] } }, orderBy: [{ account: { name: 'asc' } }, { id: 'asc' }] })
  })
  it('rejects unknown ordering before querying batches', async () => {
    expect((await GET(request('sortBy=transactions'))).status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it('denies unsigned requests before querying batches', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET(request('sortBy=rowsProcessed'))).status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
