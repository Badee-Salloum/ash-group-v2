'use client'
import { useState, useEffect } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Zap, ArrowDownToLine, ArrowUpFromLine, Layers, Users, AlertTriangle, Eye, EyeOff } from 'lucide-react'

interface Account { id: string; name: string; currency: string }

// Regex patterns to extract SC TX ID from User info (same as server-side).
// Supports the new English keys (ext_trn_id for deposits, BankTranferComment
// for withdrawals) plus the legacy Arabic format.
const SC_TX_REGEXES = [
  /ext_trn_id\s*[:：]?\s*(\d+)/i,
  /BankTranfer?Comment\s*[:：]?\s*(\d+)/i,
  /(?:معرف\s*عملية\s*شام\s*كاش|رقم\s*العملية)[^\d]*(\d+)/i,
]
function extractScTxId(userInfo: string): string {
  for (const re of SC_TX_REGEXES) {
    const m = userInfo.match(re)
    if (m) return m[1]
  }
  return ''
}

// Columns to keep per file type
const DEPOSIT_KEEP_COLS = ['Transaction ID', 'User ID', 'Amount', 'Time of deposit', 'Date of creation', 'User info', 'Currency', 'Status']
const WITHDRAWAL_KEEP_COLS = ['Transaction ID', 'User ID', 'Status', 'Currency', 'Amount', 'Time of withdrawal', 'Time of payout', 'User info']

async function cleanFileInBrowser(file: File, type: 'deposits' | 'withdrawals'): Promise<File> {
  try {
    const xlsxModule = await import('xlsx')
    const XLSX = xlsxModule.default || xlsxModule
    if (!XLSX || !XLSX.read) throw new Error('xlsx library not available')

    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw new Error('No worksheet found')

    const data: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (data.length === 0) return file

    let cleaned: Record<string, unknown>[]

    if (type === 'deposits') {
      cleaned = data.map(row => {
        const userInfo = String(row['User info'] || '')
        const scTxId = extractScTxId(userInfo)
        const result: Record<string, unknown> = {}
        for (const col of DEPOSIT_KEEP_COLS) {
          if (col === 'User info') {
            // Keep the compact form "ext_trn_id: XXX" so the server-side parser finds it
            result[col] = scTxId ? `ext_trn_id: ${scTxId}` : ''
          } else {
            // Keep all values as strings to avoid type issues
            const val = row[col]
            result[col] = val instanceof Date ? val.toISOString() : String(val ?? '')
          }
        }
        return result
      })
    } else {
      cleaned = data.map(row => {
        const userInfo = String(row['User info'] || '')
        const scTxId = extractScTxId(userInfo)
        const result: Record<string, unknown> = {}
        for (const col of WITHDRAWAL_KEEP_COLS) {
          if (col === 'User info') {
            // Keep the compact form "BankTranferComment: XXX" so the server parser still finds it.
            result[col] = scTxId ? `BankTranferComment: ${scTxId}` : ''
          } else {
            const val = row[col]
            result[col] = val instanceof Date ? val.toISOString() : String(val ?? '')
          }
        }
        return result
      })
    }

    const newWs = XLSX.utils.json_to_sheet(cleaned)
    const newWb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(newWb, newWs, 'Sheet1')
    const output = XLSX.write(newWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const blob = new Blob([new Uint8Array(output)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const cleanedName = file.name.replace(/\.xls$/i, '_cleaned.xlsx').replace(/\.xlsx$/i, '_cleaned.xlsx')
    return new File([blob], cleanedName, { type: blob.type })
  } catch (err) {
    console.warn('Client-side cleaning failed, sending original:', err)
    return file // fallback: send original file
  }
}

export default function UploadPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [shamCash, setShamCash] = useState<File | null>(null)
  const [deposits, setDeposits] = useState<File | null>(null)
  const [withdrawals, setWithdrawals] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [showZeros, setShowZeros] = useState(false)

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(d => {
      if (d.success) setAccounts(d.data)
    })
  }, [])

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId || !shamCash || !deposits || !withdrawals) {
      setError('جميع الحقول مطلوبة')
      return
    }

    setError('')
    setResult(null)
    setLoading(true)

    try {
      const totalSize = deposits.size + withdrawals.size + shamCash.size
      let finalDeposits: File = deposits
      let finalWithdrawals: File = withdrawals

      // Only clean if total size exceeds 4MB (to fit within Vercel limit)
      if (totalSize > 4 * 1024 * 1024) {
        setStatus('تنظيف الملفات لتقليص الحجم...')
        try {
          finalDeposits = await cleanFileInBrowser(deposits, 'deposits')
          finalWithdrawals = await cleanFileInBrowser(withdrawals, 'withdrawals')
          const cleanedSize = finalDeposits.size + finalWithdrawals.size + shamCash.size
          const reduction = ((1 - cleanedSize / totalSize) * 100).toFixed(0)
          setStatus(`تم التنظيف (تقليص ${reduction}%) — جاري الرفع...`)
        } catch {
          setStatus('جاري الرفع بدون تنظيف...')
        }
      } else {
        setStatus('جاري الرفع...')
      }

      const form = new FormData()
      form.append('accountId', accountId)
      form.append('shamCash', shamCash)
      form.append('deposits', finalDeposits)
      form.append('withdrawals', finalWithdrawals)

      const res = await fetch('/api/upload', { method: 'POST', body: form })

      if (!res.ok) {
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await res.json()
          throw new Error(data.error || 'خطأ في المعالجة')
        } else {
          if (res.status === 413) throw new Error('حجم الملفات لا يزال كبيراً. حاول تقسيم الملفات.')
          if (res.status === 504 || res.status === 408) throw new Error('انتهت مهلة المعالجة. حاول تقسيم الملفات لدفعات أصغر.')
          throw new Error(`خطأ من الخادم (${res.status}). حاول مرة أخرى.`)
        }
      }

      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setResult(data.summary)
      setStatus('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  function FileInput({ label, labelEn, value, onChange, accept }: {
    label: string; labelEn: string; value: File | null
    onChange: (f: File | null) => void; accept: string
  }) {
    return (
      <label className="block cursor-pointer">
        <div className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors
          ${value ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
          <div className="flex flex-col items-center gap-2">
            {value
              ? <CheckCircle size={28} className="text-green-500" />
              : <FileSpreadsheet size={28} className="text-gray-400" />}
            <div>
              <p className="font-medium text-sm text-gray-700">{label}</p>
              <p className="text-xs text-gray-400">{labelEn}</p>
            </div>
            {value
              ? <p className="text-xs text-green-600 font-medium">{value.name} ({(value.size / 1024).toFixed(0)} KB)</p>
              : <p className="text-xs text-gray-400">اضغط لاختيار الملف (xlsx, xls)</p>}
          </div>
        </div>
        <input
          type="file" className="hidden" accept={accept}
          onChange={e => onChange(e.target.files?.[0] || null)}
        />
      </label>
    )
  }

  // Translations for the lesser/secondary metrics shown in "تفاصيل إضافية"
  const extraLabels: Record<string, string> = {
    crossMatched: 'مطابقة متقاطعة (ارسال ↔ إيداع)',
    complaintsResolved: 'شكاوى تمت تسويتها',
    consolidatedGroups: 'مجموعات مدمجة',
    consolidatedRemoved: 'عمليات أُلغيت بالدمج',
    skippedAsDuplicate: 'سجلات متجاهَلة (مكرّرة)',
    employeesLinked: 'عمليات مربوطة بموظف',
    employeesUnlinked: 'عمليات بلا موظف',
    employeesAmbiguous: 'موظف غير محدّد بدقة',
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">رفع الملفات</h1>
        <p className="text-sm text-gray-500 mt-0.5">Upload Files — يُعالَج كل رفع فورياً</p>
      </div>

      <form onSubmit={handleUpload} className="card p-6 space-y-5">
        {/* Account selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الحساب</label>
          <select
            className="input" value={accountId}
            onChange={e => setAccountId(e.target.value)} required
          >
            <option value="">-- اختر الحساب --</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>
        </div>

        {/* File inputs */}
        <div className="grid grid-cols-1 gap-4">
          <FileInput
            label="ملف شام كاش" labelEn="Sham Cash Report"
            value={shamCash} onChange={setShamCash}
            accept=".xlsx,.xls"
          />
          <FileInput
            label="ملف الإيداعات" labelEn="Platform Deposits (epaylist)"
            value={deposits} onChange={setDeposits}
            accept=".xlsx,.xls"
          />
          <FileInput
            label="ملف السحوبات" labelEn="Platform Withdrawals (epayquery)"
            value={withdrawals} onChange={setWithdrawals}
            accept=".xlsx,.xls"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg max-h-64 overflow-y-auto">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
        )}

        {status && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm px-4 py-3 rounded-lg">
            <Zap size={16} className="animate-pulse shrink-0" />
            <span>{status}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
          <Upload size={16} />
          {loading ? 'جاري المعالجة...' : 'رفع ومعالجة الملفات'}
        </button>
      </form>

      {/* Result — redesigned */}
      {result && (() => {
        const num = (k: string) => Number(result[k] || 0)
        const dep = {
          matched:   num('depositMatched'),
          scOnly:    num('depositSCOnly'),
          plOnly:    num('depositPlatformOnly'),
          discr:     num('depositDiscrepancy'),
          internal:  num('depositInternalTransfers'),
        }
        const wd = {
          matched:   num('withdrawalMatched'),
          scOnly:    num('withdrawalSCOnly'),
          plOnly:    num('withdrawalPlatformOnly'),
          discr:     num('withdrawalDiscrepancy'),
          internal:  num('withdrawalInternalTransfers') || num('internalTransfers'),
        }
        const totalProcessed = dep.matched + dep.scOnly + dep.plOnly + dep.discr +
                               wd.matched + wd.scOnly + wd.plOnly + wd.discr
        const totalMatched = dep.matched + wd.matched
        const matchRate = totalProcessed > 0 ? Math.round((totalMatched / totalProcessed) * 100) : 0
        const totalIssues = dep.scOnly + dep.plOnly + dep.discr + wd.scOnly + wd.plOnly + wd.discr

        const extras = Object.entries(extraLabels).map(([k, label]) => ({
          k, label, val: num(k),
        }))
        const visibleExtras = showZeros ? extras : extras.filter(e => e.val !== 0)

        const tile = (
          icon: React.ReactNode,
          label: string,
          value: number,
          tone: 'good' | 'warn' | 'bad' | 'neutral'
        ) => {
          const cls = {
            good:    'bg-emerald-50 text-emerald-700 border-emerald-200',
            warn:    'bg-amber-50 text-amber-700 border-amber-200',
            bad:     'bg-rose-50 text-rose-700 border-rose-200',
            neutral: 'bg-gray-50 text-gray-700 border-gray-200',
          }[tone]
          return (
            <div className={`rounded-lg border px-3 py-2 flex items-center justify-between ${cls}`}>
              <div className="flex items-center gap-1.5">
                <span className="opacity-70">{icon}</span>
                <span className="text-[11px]">{label}</span>
              </div>
              <span className="font-mono font-bold text-base">{value}</span>
            </div>
          )
        }

        return (
          <div className="space-y-4">
            {/* Hero */}
            <div className="card p-5 bg-gradient-to-l from-emerald-50 via-white to-white border-r-4 border-emerald-500">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle size={22} className="text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900">تمت المعالجة بنجاح</h2>
                    <p className="text-xs text-gray-500">{totalProcessed.toLocaleString('en')} عملية معالَجة · {totalIssues} تحتاج مراجعة</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">نسبة المطابقة</p>
                    <p className="text-2xl font-extrabold font-mono text-emerald-700">{matchRate}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">مطابقة</p>
                    <p className="text-2xl font-extrabold font-mono text-gray-800">{totalMatched}</p>
                  </div>
                </div>
              </div>
              {/* Match-rate progress bar */}
              <div className="mt-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-l from-emerald-500 to-emerald-300 transition-all"
                  style={{ width: `${matchRate}%` }} />
              </div>
            </div>

            {/* Two side-by-side sections: Deposits / Withdrawals */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Deposits */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <ArrowDownToLine size={16} className="text-emerald-500" />
                    <h3 className="font-bold text-gray-800">الإيداعات</h3>
                  </div>
                  <span className="text-[11px] text-gray-400">{dep.matched + dep.scOnly + dep.plOnly + dep.discr + dep.internal} عملية</span>
                </div>
                <div className="space-y-2">
                  {tile(<CheckCircle size={13} />, 'مطابقة', dep.matched, 'good')}
                  {tile(<AlertCircle size={13} />, 'شام كاش فقط', dep.scOnly, dep.scOnly > 0 ? 'warn' : 'neutral')}
                  {tile(<AlertCircle size={13} />, 'المنصة فقط', dep.plOnly, dep.plOnly > 0 ? 'warn' : 'neutral')}
                  {tile(<AlertTriangle size={13} />, 'بفارق مبلغ', dep.discr, dep.discr > 0 ? 'bad' : 'neutral')}
                  {tile(<ArrowDownToLine size={13} />, 'تحويلات داخلية', dep.internal, 'neutral')}
                </div>
              </div>

              {/* Withdrawals */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <ArrowUpFromLine size={16} className="text-blue-500" />
                    <h3 className="font-bold text-gray-800">السحوبات</h3>
                  </div>
                  <span className="text-[11px] text-gray-400">{wd.matched + wd.scOnly + wd.plOnly + wd.discr + wd.internal} عملية</span>
                </div>
                <div className="space-y-2">
                  {tile(<CheckCircle size={13} />, 'مطابقة', wd.matched, 'good')}
                  {tile(<AlertCircle size={13} />, 'شام كاش فقط', wd.scOnly, wd.scOnly > 0 ? 'warn' : 'neutral')}
                  {tile(<AlertCircle size={13} />, 'المنصة فقط', wd.plOnly, wd.plOnly > 0 ? 'warn' : 'neutral')}
                  {tile(<AlertTriangle size={13} />, 'بفارق مبلغ', wd.discr, wd.discr > 0 ? 'bad' : 'neutral')}
                  {tile(<ArrowUpFromLine size={13} />, 'تحويلات داخلية', wd.internal, 'neutral')}
                </div>
              </div>
            </div>

            {/* Extra metrics (collapsible / hide-zero) */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Layers size={16} className="text-gray-500" />
                  <h3 className="font-bold text-gray-800">تفاصيل إضافية</h3>
                </div>
                <button
                  onClick={() => setShowZeros(s => !s)}
                  className="btn-ghost btn-sm text-[11px] inline-flex items-center gap-1"
                >
                  {showZeros ? <><EyeOff size={11} /> إخفاء الأصفار</> : <><Eye size={11} /> إظهار الكل</>}
                </button>
              </div>
              {visibleExtras.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-2">لا تحتاج لمراجعة شيء — كل شيء صفر.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {visibleExtras.map(e => (
                    <div key={e.k} className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-600">{e.label}</span>
                      <span className={`font-mono font-bold ${e.val > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{e.val}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-400">
                <Users size={11} />
                <span>الموظفون المربوطون بالعمليات يظهرون في صفحة "أوقات الدوام" و"الرواتب"</span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
