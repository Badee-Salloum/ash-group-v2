import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findMany: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { auditLog: { create: m.create, update: m.update, findMany: m.findMany } } }))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
import { createAttemptTracker } from '@/lib/uploads/attempts'
import { withAuditContext, getAuditMetadata } from '@/lib/audit/context'
import { GET } from '@/app/api/upload/attempts/route'
const context = { actorType: 'SERVICE' as const, authMethod: 'OPS_TOKEN' as const, actorUserId: null, requestId: 'r', operationId: 'id' }
beforeEach(() => { vi.resetAllMocks(); m.findMany.mockResolvedValue([]); m.session.mockResolvedValue({ userId: 'u', role: 'ADMIN' }) })
describe('durable upload progress', () => {
  it('retains failure after parsing with no batch or financial mutation', async () => {
    await withAuditContext(context, async () => {
      const tracker = createAttemptTracker('id')
      await tracker.start(); await tracker.stage('PARSING'); await tracker.stage('FAILED', { errorCode: 'INVALID_FILE' })
    })
    expect(m.create.mock.calls[0][0].data).toMatchObject({ id: 'id', userId: null, action: 'UPLOAD_ATTEMPT', details: context })
    const details = m.update.mock.calls[1][0].data.details
    expect(details.status).toBe('FAILED'); expect(details.completedAt).toBeTruthy()
    expect(details.stages.map((s: { stage: string }) => s.stage)).toEqual(['RECEIVING', 'PARSING', 'FAILED'])
    expect(details).not.toHaveProperty('rawData')
  })
  it('isolates service and human contexts under concurrent work', async () => {
    const actors = await Promise.all([withAuditContext(context, async () => { await Promise.resolve(); return getAuditMetadata() }),
      withAuditContext({ ...context, actorType: 'HUMAN', actorUserId: 'human', authMethod: 'SESSION' }, async () => { await Promise.resolve(); return getAuditMetadata() })])
    expect(actors[0].actorUserId).toBeNull(); expect(actors[1].actorUserId).toBe('human')
    expect(getAuditMetadata().actorType).toBe('UNKNOWN')
  })
  it('requires authentication and role before inspecting attempts', async () => {
    m.session.mockResolvedValue(null)
    expect((await GET(new NextRequest('http://localhost/api/upload/attempts'))).status).toBe(401)
    m.session.mockResolvedValue({ userId: 'u', role: 'EMPLOYEE' })
    expect((await GET(new NextRequest('http://localhost/api/upload/attempts'))).status).toBe(403)
    expect(m.findMany).not.toHaveBeenCalled()
  })
  it('keeps supervisor attempts private and paged; omits raw audit details', async () => {
    m.session.mockResolvedValue({ userId: 'u', role: 'SUPERVISOR' })
    m.findMany.mockResolvedValue([{ id: 'id', createdAt: new Date(), details: { ...context, stage: 'PARSING', status: 'PROCESSING', rawData: 'secret' } }])
    const response = await GET(new NextRequest('http://localhost/api/upload/attempts?id=id'))
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'u', id: 'id' }, take: 1 })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
  it('marks a timed-out request as unconfirmed, never falsely successful', async () => {
    m.findMany.mockResolvedValue([{ id: 'id', createdAt: new Date(Date.now() - 180000), details: { stage: 'HISTORICAL', status: 'PROCESSING' } }])
    const response = await GET(new NextRequest('http://localhost/api/upload/attempts'))
    expect((await response.json()).data[0]).toMatchObject({ status: 'INTERRUPTED' })
  })
})
