import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { encodeTransactionCursor } from '@/lib/transactions/query'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    $queryRawUnsafe: vi.fn(),
    expense: { count: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    auditLog: { count: vi.fn(), findMany: vi.fn() },
    transaction: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    user: { findMany: vi.fn() }, accountAccess: { findMany: vi.fn() }, shiftSession: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session, requireRole: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: mocks.db }))
vi.mock('@/lib/performance/cache', () => ({ invalidateFinancialReadModels: vi.fn() }))
import { GET as expenses } from '@/app/api/expenses/route'
import { GET as consolidations } from '@/app/api/consolidation-log/route'
import { GET as followUps } from '@/app/api/follow-ups/route'
import { GET as queue } from '@/app/api/shift-manager/overview/route'
const req = (params: string) => ({ url: `http://localhost?${params}`, nextUrl: new URL(`http://localhost?${params}`) }) as NextRequest
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'ADMIN' })
  mocks.db.expense.count.mockResolvedValue(125)
  mocks.db.expense.findMany.mockResolvedValue([])
  mocks.db.expense.aggregate.mockResolvedValue({ _sum: { amount: '12500.50' } })
  mocks.db.auditLog.count.mockResolvedValue(150)
  mocks.db.auditLog.findMany.mockResolvedValue([])
  mocks.db.$queryRawUnsafe.mockImplementation(async sql => sql.includes('count(*)') ? [{ total: 150 }] : [])
  mocks.db.transaction.count.mockResolvedValue(125)
  mocks.db.transaction.findMany.mockResolvedValue([])
  mocks.db.transaction.groupBy.mockResolvedValue([])
  mocks.db.user.findMany.mockResolvedValue([])
  mocks.db.accountAccess.findMany.mockResolvedValue([{ accountId: 'allowed' }])
  mocks.db.shiftSession.findMany.mockResolvedValue([{ id: 'shift', userId: 'employee', startAt: new Date(), user: { id: 'employee', name: 'Employee' }, wallets: [] }])
})
describe('remaining server-paged tables', () => {
  it.each(['expenseDate', 'description', 'category', 'amount', 'createdBy'])('sorts all expense results by %s before paging', async key => {
    const response = await expenses(req(`sortBy=${key}&sortDir=asc&page=2&pageSize=25&search=rent`))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.totalAmount).toBe(12500.5)
    expect(payload.meta.total).toBe(125)
    expect(mocks.db.expense.findMany.mock.calls[0][0]).toMatchObject({ skip: 25, take: 25, orderBy: [expect.anything(), { id: 'asc' }] })
    expect(mocks.db.expense.aggregate.mock.calls[0][0].where).toEqual(mocks.db.expense.count.mock.calls[0][0].where)
    expect(response.headers.get('Cache-Control')).toContain('private')
  })
  it('bounds expenses and preserves forbidden-role checks', async () => {
    await expenses(req('pageSize=1000000'))
    expect(mocks.db.expense.findMany.mock.calls[0][0].take).toBe(100)
    mocks.session.mockResolvedValue({ userId: 'manager', role: 'ACCOUNT_MGR' })
    expect((await expenses(req('sortBy=amount'))).status).toBe(403)
  })
  it.each(['account', 'accountName', 'amount', 'depositSC', 'withdrawalSC', 'depositAccNum', 'withdrawalAccNum', 'notes', 'user'])('orders consolidation JSON column %s in SQL', async key => {
    const response = await consolidations(req(`sortBy=${key}&sortDir=asc&page=2&pageSize=50&accountId=allowed`))
    expect(response.status).toBe(200)
    const [sql, ...values] = mocks.db.$queryRawUnsafe.mock.calls[1]
    expect(sql).toContain('ORDER BY ')
    expect(sql).toContain(' ASC NULLS LAST, l.id ASC LIMIT $2 OFFSET $3')
    expect(values).toEqual(['allowed', 50, 50])
  })
  it('searches consolidation records before count and page instead of filtering one page', async () => {
    await consolidations(req('q=123'))
    expect(mocks.db.$queryRawUnsafe.mock.calls[0]).toContain('%123%')
    expect(mocks.db.$queryRawUnsafe.mock.calls[1]).toContain('%123%')
  })
  it('retains follow-up account-manager scope while sorting by assignee', async () => {
    mocks.session.mockResolvedValue({ userId: 'manager', role: 'ACCOUNT_MGR' })
    const response = await followUps(req('sortBy=followUpAssigneeName&sortDir=asc&page=2&pageSize=50'))
    expect(response.status).toBe(200)
    expect(mocks.db.transaction.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ followUpAssignee: { name: 'asc' } }, { id: 'asc' }], skip: 50, take: 50,
      where: { accountId: { in: ['allowed'] } },
    })
  })
  it('never expands an employee follow-up scope when an assignee filter is supplied', async () => {
    mocks.session.mockResolvedValue({ userId: 'employee', role: 'EMPLOYEE' })
    await followUps(req('sortBy=amount&assignedTo=someone-else'))
    expect(mocks.db.transaction.findMany.mock.calls[0][0].where.followUpAssignedTo).toBe('employee')
  })
  it('orders the entire active confirmation queue with keyset pagination', async () => {
    const cursor = encodeTransactionCursor({ id: 'last', sortBy: 'amount', sortDir: 'asc', value: '75.00' })
    const response = await queue(req(`sortBy=amount&sortDir=asc&limit=25&cursor=${cursor}`))
    expect(response.status).toBe(200)
    expect(mocks.db.transaction.findMany.mock.calls[0][0]).toMatchObject({ take: 26, orderBy: [{ amount: 'asc' }, { id: 'asc' }] })
    const filter = mocks.db.transaction.findMany.mock.calls[0][0].where
    expect(JSON.stringify(filter)).toContain('"handledByUserId":{"in":["employee"]}')
    expect(JSON.stringify(filter)).toContain('"amount":{"gt":"75.00"}')
    expect(JSON.stringify(mocks.db.transaction.count.mock.calls[0][0])).not.toContain('75.00')
  })
  it('rejects invalid ordering before touching financial rows', async () => {
    for (const handler of [expenses, consolidations, followUps, queue]) expect((await handler(req('sortBy=rawData'))).status).toBe(400)
    expect(mocks.db.transaction.findMany).not.toHaveBeenCalled()
    expect(mocks.db.expense.findMany).not.toHaveBeenCalled()
  })
})
