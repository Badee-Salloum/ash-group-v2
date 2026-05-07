'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, ChevronRight, Loader2, Users } from 'lucide-react'

interface TreeNode {
  id: string
  name: string
  jobTitle: string | null
  employeeCode: string | null
  role: string
  avatarUrl: string | null
  children: TreeNode[]
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير عام',
  MANAGER: 'مدير فرع',
  SUPERVISOR: 'مشرف',
  ACCOUNT_MGR: 'مدير حساب',
  EMPLOYEE: 'موظف',
}

const ROLE_STYLE: Record<string, { ring: string; badge: string; avatar: string }> = {
  ADMIN:       { ring: 'ring-purple-300/60',  badge: 'bg-purple-100 text-purple-700',  avatar: 'from-purple-500 to-purple-700' },
  MANAGER:     { ring: 'ring-indigo-300/60',  badge: 'bg-indigo-100 text-indigo-700',  avatar: 'from-indigo-500 to-indigo-700' },
  SUPERVISOR:  { ring: 'ring-emerald-300/60', badge: 'bg-emerald-100 text-emerald-700',avatar: 'from-emerald-500 to-emerald-700' },
  ACCOUNT_MGR: { ring: 'ring-amber-300/60',   badge: 'bg-amber-100 text-amber-700',    avatar: 'from-amber-500 to-amber-700' },
  EMPLOYEE:    { ring: 'ring-gray-200',       badge: 'bg-gray-100 text-gray-700',      avatar: 'from-slate-400 to-slate-600' },
}

function NodeCard({ node, depth = 0, isLast = false }: { node: TreeNode; depth?: number; isLast?: boolean }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const style = ROLE_STYLE[node.role] || ROLE_STYLE.EMPLOYEE

  return (
    <div className="relative">
      {/* Connector elbow */}
      {depth > 0 && (
        <span
          className="absolute right-[-22px] top-7 w-5 h-px bg-gray-200"
          aria-hidden
        />
      )}

      <div className={`inline-flex items-center gap-3 bg-white border border-gray-200 rounded-xl py-2 pr-2 pl-4 shadow-sm hover:shadow-md ring-1 ${style.ring} transition-all min-w-[280px]`}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-6 h-6 rounded-md hover:bg-gray-100 text-gray-500 flex items-center justify-center shrink-0"
            aria-label={expanded ? 'طيّ' : 'توسيع'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        {node.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={node.avatarUrl} alt={node.name} className="w-9 h-9 rounded-full object-cover shrink-0 ring-2 ring-white" />
        ) : (
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${style.avatar} text-white flex items-center justify-center font-bold text-xs shrink-0`}>
            {node.name.charAt(0)}
          </div>
        )}

        <div className="flex-1 min-w-0 ml-1">
          <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{node.name}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {node.jobTitle || ROLE_LABELS[node.role] || '—'}
            {node.employeeCode && <span className="font-mono text-gray-400 mr-1">· {node.employeeCode}</span>}
          </p>
        </div>

        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge} shrink-0`}>
          {ROLE_LABELS[node.role] || node.role}
        </span>

        {hasChildren && (
          <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
            <Users size={10} /> {node.children.length}
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div className="mr-7 mt-3 relative">
          {/* vertical guide line */}
          <span
            className={`absolute right-0 top-0 w-px bg-gray-200 ${isLast ? '' : ''}`}
            style={{ height: 'calc(100% - 1.75rem)' }}
            aria-hidden
          />
          <div className="space-y-3 pr-6">
            {node.children.map((child, i) => (
              <NodeCard key={child.id} node={child} depth={depth + 1} isLast={i === node.children.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OrgTreePage() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/employees/tree')
      .then(r => r.json())
      .then(d => {
        if (d.success) setTree(d.data || [])
      })
      .finally(() => setLoading(false))
  }, [])

  // Total count across the tree
  const countAll = (nodes: TreeNode[]): number =>
    nodes.reduce((s, n) => s + 1 + countAll(n.children), 0)
  const total = countAll(tree)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/employees" className="btn-secondary btn-sm">
            <ArrowRight size={14} /> العودة للموظفين
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">الهيكل التنظيمي</h1>
            <p className="text-sm text-gray-500 mt-0.5">العلاقات الإدارية بين الموظفين</p>
          </div>
        </div>
        {!loading && total > 0 && (
          <span className="badge bg-blue-50 text-blue-700">
            <Users size={12} /> {total} موظف
          </span>
        )}
      </div>

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={32} className="mx-auto animate-spin mb-3" />
          جاري التحميل...
        </div>
      ) : tree.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-30" />
          لا يوجد موظفون لعرضهم
        </div>
      ) : (
        <div className="card p-6 overflow-x-auto">
          <div className="space-y-4 min-w-fit">
            {tree.map((root, i) => (
              <NodeCard key={root.id} node={root} isLast={i === tree.length - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
