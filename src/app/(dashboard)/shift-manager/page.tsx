'use client'
import { SortableTable, type TableSort } from '@/components/tables/SortableTable'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Loader2, RefreshCw, Clock, AlertTriangle, CheckCircle2, Search, Users, Sparkles } from 'lucide-react'
import { fmtSyria } from '@/lib/datetime'
import { useToast } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui/PageHeader'

interface ActiveRow {
  sessionId: string
  userId: string
  userName: string
  employeeCode: string | null
  avatarUrl: string | null
  status: string
  startAt: string
  shiftNumber: string | null
  accountIds: string[]
}

interface UnconfirmedRow {
  id: string
  shamCashTxId: string | null
  platformTxId: string | null
  amount: string
  currency: string
  txDateTime: string
  status: string
  reviewCategory: string | null
  hasDelay: boolean
  handledByUser: { id: string; name: string } | null
  account: { name: string } | null
}

interface SummaryRow {
  userId: string
  name: string
  matched: number
  errors: number
  total: number
  delays: number
  accuracy: number
}

export default function ShiftManagerPage() {
  const toast = useToast()
  const [active, setActive] = useState<ActiveRow[]>([])
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedRow[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [delayRef, setDelayRef] = useState('')
  const [posting, setPosting] = useState(false)

  // Search + selection for the confirm queue.
  const [queueSearch, setQueueSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queueSort, setQueueSort] = useState<TableSort>({ index: 1, direction: 'desc' })
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState<{ cursor: string | null; history: Array<string | null> }>({ cursor: null, history: [] })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [queueTotal, setQueueTotal] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => { setPosition({ cursor: null, history: [] }); setSearch(queueSearch.trim()) }, 300)
    return () => clearTimeout(timer)
  }, [queueSearch])

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const keys = ['', 'txDateTime', 'handledByUser', 'account', 'shamCashTxId', 'platformTxId', 'amount', 'hasDelay']
      const params = new URLSearchParams({ sortBy: keys[queueSort.index], sortDir: queueSort.direction, limit: '50' })
      if (search) params.set('search', search)
      if (position.cursor) params.set('cursor', position.cursor)
      const res = await fetch('/api/shift-manager/overview?' + params, { signal: controller.signal, cache: 'no-store' }).then(r => r.json())
      if (controller.signal.aborted) return
      if (res.success) {
        setActive(res.active)
        setUnconfirmed(res.unconfirmed)
        setSummary(res.summary)
        setQueueTotal(res.pageInfo?.total || 0)
        setNextCursor(res.pageInfo?.nextCursor || null)
        // Drop selections for rows that vanished.
        setSelected(prev => {
          const alive = new Set(res.unconfirmed.map((u: UnconfirmedRow) => u.id))
          const next = new Set<string>()
          for (const id of prev) if (alive.has(id)) next.add(id)
          return next
        })
      }
    } catch (e) {
      if (!controller.signal.aborted) toast('تعذر تحميل العمليات. أعد المحاولة من زر تحديث.', 'error')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [queueSort, position.cursor, search, toast])

  useEffect(() => { void load(); return () => abortRef.current?.abort() }, [load])

  async function logDelay() {
    if (!delayRef.trim()) return
    setPosting(true)
    try {
      const r = await fetch('/api/transactions/log-delay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: delayRef.trim() }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      toast('تمّ تسجيل التأخير', 'success')
      setDelayRef('')
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setPosting(false)
    }
  }

  async function confirmOne(id: string) {
    try {
      const r = await fetch('/api/transactions/shift-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      setUnconfirmed(u => u.filter(x => x.id !== id))
      setSelected(prev => {
        const next = new Set(prev); next.delete(id); return next
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function confirmBatch() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    let ok = 0, failed = 0
    for (const id of ids) {
      try {
        const r = await fetch('/api/transactions/shift-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        const d = await r.json()
        if (d.success) ok++; else failed++
      } catch { failed++ }
    }
    if (failed === 0) {
      toast(`تمّ تأكيد ${ok} عملية`, 'success')
    } else {
      toast(`نجح ${ok} · فشل ${failed}`, 'error')
    }
    setSelected(new Set())
    load()
  }

  const filteredQueue = useMemo(() => {
    if (!queueSearch.trim()) return unconfirmed
    const q = queueSearch.trim().toLowerCase()
    return unconfirmed.filter(u => (
      (u.shamCashTxId ?? '').toLowerCase().includes(q) ||
      (u.platformTxId ?? '').toLowerCase().includes(q) ||
      (u.handledByUser?.name ?? '').toLowerCase().includes(q) ||
      (u.account?.name ?? '').toLowerCase().includes(q)
    ))
  }, [unconfirmed, queueSearch])

  function toggleAll() {
    const allIds = filteredQueue.map(u => u.id)
    const allSelected = allIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) allIds.forEach(id => next.delete(id))
      else allIds.forEach(id => next.add(id))
      return next
    })
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={<Sparkles size={20} />}
        title="لوحة مدير النوبة"
        subtitle="راجع النوبات المفتوحة، سجّل التأخيرات، وأكّد العمليات."
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            تحديث
          </button>
        }
      />

      {/* Primary task — unconfirmed queue moved to the top. */}
      <div className="card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <h2 className="text-sm font-bold text-gray-700">
            العمليات بانتظار التأكيد ({queueTotal})
          </h2>
          <div className="mr-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                className="input py-1 text-xs pr-8 w-52"
                placeholder="بحث بالرقم / الموظف / الحساب"
                value={queueSearch}
                onChange={e => setQueueSearch(e.target.value)}
              />
            </div>
            {selected.size > 0 && (
              <button onClick={confirmBatch} className="btn-primary btn-sm inline-flex items-center gap-1">
                <CheckCircle2 size={13} />
                تأكيد المحدَّد ({selected.size})
              </button>
            )}
          </div>
        </div>

        {/* Delay input right below the queue actions. */}
        <div className="flex items-center gap-2 flex-wrap mb-3 p-2 bg-amber-50/60 rounded-lg border border-amber-100">
          <AlertTriangle size={13} className="text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">تسجيل تأخير:</span>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              className="input py-1 text-xs pr-8 w-full"
              placeholder="رقم شام كاش أو رقم المنصة"
              value={delayRef}
              onChange={e => setDelayRef(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') logDelay() }}
            />
          </div>
          <button onClick={logDelay} disabled={posting || !delayRef.trim()} className="btn-primary btn-sm inline-flex items-center gap-1">
            {posting ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
            تسجيل
          </button>
        </div>

        {filteredQueue.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">لا عمليات بانتظار التأكيد.</p>
        ) : (
          <div className="overflow-x-auto">
            <SortableTable className="w-full text-sm" sort={queueSort} onSortChange={next => { setPosition({ cursor: null, history: [] }); setQueueSort(next) }} sortableIndexes={[1, 2, 3, 4, 5, 6, 7]}>
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 w-8 text-center">
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      checked={filteredQueue.length > 0 && filteredQueue.every(u => selected.has(u.id))}
                      aria-label="تحديد الكل"
                    />
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">الوقت</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">الحساب</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">SC</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">المنصة</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">المبلغ</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">تأخير</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">تأكيد</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map(u => (
                  <tr key={u.id} className={`border-t border-gray-100 ${selected.has(u.id) ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={e => {
                          setSelected(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(u.id); else next.delete(u.id)
                            return next
                          })
                        }}
                        aria-label={`تحديد ${u.shamCashTxId ?? u.platformTxId ?? u.id}`}
                      />
                    </td>
                    <td data-sort-value={u.txDateTime} className="px-3 py-2 text-xs text-gray-500">{fmtSyria(u.txDateTime)}</td>
                    <td className="px-3 py-2">{u.handledByUser?.name ?? '—'}</td>
                    <td className="px-3 py-2">{u.account?.name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.shamCashTxId ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.platformTxId ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{Number(u.amount).toLocaleString('en')} {u.currency}</td>
                    <td className="px-3 py-2 text-center">
                      {u.hasDelay && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title="تم تسجيل تأخير">
                          <AlertTriangle size={10} /> تأخير
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => confirmOne(u.id)}
                        className="btn-primary btn-sm inline-flex items-center gap-1 text-[11px]"
                      >
                        <CheckCircle2 size={11} /> تأكيد
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>
        )}
      </div>

      {/* Performance summary — moved beneath the primary queue. */}
      <div className="flex justify-center items-center gap-3 text-xs">
        <button className="btn-secondary btn-sm" disabled={loading || !position.history.length} onClick={() => setPosition(p => ({ cursor: p.history.at(-1) ?? null, history: p.history.slice(0, -1) }))}>السابق</button>
        <span>صفحة {position.history.length + 1}</span>
        <button className="btn-secondary btn-sm" disabled={loading || !nextCursor} onClick={() => setPosition(p => ({ cursor: nextCursor, history: [...p.history, p.cursor] }))}>التالي</button>
      </div>
      <div className="card p-4">
        <h2 className="text-sm font-bold text-gray-700 mb-3">ملخّص الأداء الآن</h2>
        {summary.length === 0 ? (
          <p className="text-sm text-gray-400 py-2 text-center">—</p>
        ) : (
          <div className="overflow-x-auto">
            <SortableTable className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">الموظف</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">مطابق</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">أخطاء</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">تأخيرات</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-600">الدقة %</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr key={s.userId} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-center font-mono text-emerald-700">{s.matched}</td>
                    <td className="px-3 py-2 text-center font-mono text-rose-700">{s.errors}</td>
                    <td className="px-3 py-2 text-center font-mono text-amber-700">{s.delays}</td>
                    <td className={`px-3 py-2 text-center font-mono font-bold ${s.accuracy >= 99 ? 'text-emerald-700' : s.accuracy >= 95 ? 'text-amber-700' : 'text-rose-700'}`}>
                      {s.accuracy.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>
        )}
      </div>

      {/* Active shifts — informational context, kept last. */}
      <div className="card p-4">
        <h2 className="text-sm font-bold text-gray-700 mb-3 inline-flex items-center gap-2">
          <Clock size={14} className="text-blue-600" />
          <Users size={14} className="text-blue-600" />
          من متواجد الآن ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">لا نوبات مفتوحة حالياً.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map(a => (
              <div key={a.sessionId} className="border border-gray-200 rounded-xl p-3 bg-gradient-to-bl from-blue-50/40 to-white">
                <p className="font-semibold text-gray-900">{a.userName}</p>
                <p className="text-[11px] text-gray-500 font-mono">{a.employeeCode ?? '—'}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <Clock size={11} /> بدأ {fmtSyria(a.startAt)}
                </div>
                {a.shiftNumber && (
                  <span className="mt-1 inline-block text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    النوبة {a.shiftNumber}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
