'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronUp, ChevronDown, Download, Search, ChevronLeft, ChevronRight, Columns } from 'lucide-react'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
  /** Optional custom accessor for sorting (useful when the cell value is an object
   *  like {USD: 100, SYP: 5} — return a number to sort on). */
  sortAccessor?: (row: T) => string | number
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  searchable?: boolean
  exportable?: boolean
  exportFilename?: string
  excelExportUrl?: string
  pageSize?: number
  loading?: boolean
  emptyMessage?: string
}

export default function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  searchable = true,
  exportable = true,
  exportFilename = 'export',
  excelExportUrl,
  pageSize: defaultPageSize = 50,
  loading = false,
  emptyMessage = 'لا توجد بيانات',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [showColMenu, setShowColMenu] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const colMenuRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const visibleCols = columns.filter(c => !hiddenCols.has(c.key))

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setShowColMenu(false)
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Deep search: recursively check all string/number values within row including nested objects.
  // Supports multi-term OR search — separate terms with comma, newline, or the word "أو".
  // A row matches if ANY of the terms appears anywhere in its values.
  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const terms = search
      .split(/\s*,\s*|\s*\bأو\b\s*|\s*\|\s*|\n+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
    if (terms.length === 0) return data

    const matchValueWithTerm = (val: unknown, term: string): boolean => {
      if (val === null || val === undefined) return false
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return String(val).toLowerCase().includes(term)
      }
      if (val instanceof Date) return val.toISOString().toLowerCase().includes(term)
      if (Array.isArray(val)) return val.some(v => matchValueWithTerm(v, term))
      if (typeof val === 'object') return Object.values(val as Record<string, unknown>).some(v => matchValueWithTerm(v, term))
      return false
    }

    return data.filter(row => terms.some(term => matchValueWithTerm(row, term)))
  }, [data, search])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const sortCol = columns.find(c => c.key === sortKey)
    const extractSortValue = (row: T, key: string): string | number => {
      // Prefer custom sortAccessor when provided (for complex cells like multi-currency objects)
      if (sortCol?.sortAccessor) {
        try { return sortCol.sortAccessor(row) } catch { /* fall through */ }
      }
      const val = row[key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'number') return val
      if (typeof val === 'string') {
        const n = parseFloat(val)
        if (!isNaN(n) && isFinite(n) && val.match(/^-?\d+(\.\d+)?$/)) return n
        return val.toLowerCase()
      }
      if (val instanceof Date) return val.getTime()
      if (typeof val === 'object') {
        const obj = val as Record<string, unknown>
        if ('name' in obj) return String(obj.name).toLowerCase()
        // For a {currency: amount} object, sum the numeric values
        const nums = Object.values(obj).filter(v => typeof v === 'number') as number[]
        if (nums.length > 0) return nums.reduce((s, v) => s + v, 0)
        return JSON.stringify(obj)
      }
      return String(val).toLowerCase()
    }
    return [...filtered].sort((a, b) => {
      const av = extractSortValue(a, sortKey)
      const bv = extractSortValue(b, sortKey)
      if (av === bv) return 0
      const cmp = av < bv ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir, columns])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize)

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  function toggleColumn(key: string) {
    const next = new Set(hiddenCols)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setHiddenCols(next)
  }

  function extractText(val: unknown): string {
    if (val === null || val === undefined) return ''
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val)
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>
      if ('name' in obj) return String(obj.name)
      return ''
    }
    return String(val)
  }

  function buildExportRows() {
    return sorted.map(row => visibleCols.map(c => extractText(row[c.key])))
  }

  function handleExportCSV() {
    const headers = visibleCols.map(c => c.header)
    const rows = buildExportRows().map(r => r.map(v => `"${v.replace(/"/g, '""')}"`))
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `${exportFilename}.csv`)
    setShowExportMenu(false)
  }

  function handleExportExcel() {
    if (excelExportUrl) {
      window.open(excelExportUrl, '_blank')
    } else {
      // Fallback: export as TSV with .xls extension (opens in Excel)
      const headers = visibleCols.map(c => c.header)
      const rows = buildExportRows()
      const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n')
      const blob = new Blob(['\uFEFF' + tsv], { type: 'application/vnd.ms-excel;charset=utf-8' })
      downloadBlob(blob, `${exportFilename}.xls`)
    }
    setShowExportMenu(false)
  }

  function handleExportPDF() {
    // Build a printable HTML table and trigger print
    const headers = visibleCols.map(c => c.header)
    const rows = buildExportRows()
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>${exportFilename}</title>
      <style>
        body{font-family:'IBM Plex Sans Arabic',sans-serif;padding:20px;font-size:12px}
        h1{font-size:18px;margin-bottom:4px}
        p{color:#666;font-size:11px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse}
        th{background:#0a2540;color:white;padding:8px 10px;text-align:right;font-size:11px}
        td{padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-size:11px}
        tr:nth-child(even){background:#f8f9fb}
        @media print{body{padding:0}button{display:none}}
      </style>
    </head><body>
      <h1>ASH GROUP — ${exportFilename}</h1>
      <p>${new Date().toLocaleDateString('ar-SY')} — ${sorted.length} عملية</p>
      <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <script>window.onload=()=>window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
    setShowExportMenu(false)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 sm:px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2 sm:gap-3">
        {searchable && (
          <div className="relative w-full sm:flex-1 sm:min-w-48 order-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pr-8 py-1.5 text-sm"
              placeholder="بحث... (عدة كلمات: بشار, 1628241961)"
              title="ابحث عن عدة قيم معاً: افصلها بفاصلة ، أو بكلمة أو ، أو بـ |"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
        )}
        <div className="flex items-center gap-2 sm:mr-auto order-2 flex-wrap">
          <select
            className="input py-1.5 text-sm w-auto"
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
          >
            {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} صف</option>)}
          </select>

          {/* Column visibility */}
          <div className="relative" ref={colMenuRef}>
            <button onClick={() => setShowColMenu(!showColMenu)} className="btn-secondary btn-sm" title="الأعمدة">
              <Columns size={14} />
            </button>
            {showColMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 p-2 z-50 min-w-52 animate-fade-in">
                <p className="text-xs font-semibold text-gray-400 px-2 py-1 mb-1">الأعمدة المعروضة</p>
                {columns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
                    <input type="checkbox" checked={!hiddenCols.has(col.key)} onChange={() => toggleColumn(col.key)}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-sm text-gray-700">{col.header}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Export dropdown */}
          {exportable && (
            <div className="relative" ref={exportMenuRef}>
              <button onClick={() => setShowExportMenu(!showExportMenu)} className="btn-secondary btn-sm">
                <Download size={14} /> تصدير
              </button>
              {showExportMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 shadow-xl rounded-xl border border-gray-100 dark:border-gray-800 py-1 z-50 min-w-40 animate-fade-in">
                  <button onClick={handleExportCSV}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    <span className="w-8 text-[10px] font-bold text-gray-400">CSV</span>
                    <span>تصدير CSV</span>
                  </button>
                  <button onClick={handleExportExcel}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    <span className="w-8 text-[10px] font-bold text-emerald-600">XLS</span>
                    <span>تصدير Excel</span>
                  </button>
                  <button onClick={handleExportPDF}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    <span className="w-8 text-[10px] font-bold text-red-500">PDF</span>
                    <span>تصدير PDF</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : {}}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={col.sortable !== false ? 'cursor-pointer select-none hover:bg-gray-100/50 transition-colors' : ''}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable !== false && sortKey === col.key && (
                      sortDir === 'asc' ? <ChevronUp size={13} className="text-brand-600" /> : <ChevronDown size={13} className="text-brand-600" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {visibleCols.map(col => (
                    <td key={col.key}><div className="skeleton h-4 w-3/4 rounded" /></td>
                  ))}
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr><td colSpan={visibleCols.length} className="text-center py-16 text-gray-400">{emptyMessage}</td></tr>
            ) : paginated.map((row, i) => (
              <tr key={i}>
                {visibleCols.map(col => (
                  <td key={col.key}>{col.render ? col.render(row) : String(row[col.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, sorted.length)} من {sorted.length.toLocaleString('ar')}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost btn-sm p-1.5 rounded-lg">
              <ChevronRight size={16} />
            </button>
            <span className="px-3 font-medium">صفحة {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost btn-sm p-1.5 rounded-lg">
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
