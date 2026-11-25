'use client'
// Leave-groups editor. Splits each shift (ONE / TWO / THREE) into manager-
// defined groups (up to 6 members) + a pool of "spares". Every group has
// exactly one cover employee picked from the spare pool — that person
// covers whenever any member of the group takes their fixed weekly leave.
//
// Wire:
//   GET  /api/manager/leave-groups → { perShift: { ONE|TWO|THREE: {groups, spares} } }
//   POST /api/leave-groups         → create empty group
//   PATCH /api/leave-groups/[id]   → rename / recover / re-membership
//   DELETE /api/leave-groups/[id]  → dissolve group (members → spares)
//   PUT  /api/employees            → change one member's weeklyOffDay
//                                    (adjacent-day constraint enforced there)

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Users, X, RefreshCw, AlertTriangle, Info, Shield, Sparkles } from 'lucide-react'
import { useConfirm, usePrompt } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

type ShiftNum = 'ONE' | 'TWO' | 'THREE'

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const SHIFT_LABELS: Record<ShiftNum, string> = { ONE: 'النوبة الأولى', TWO: 'النوبة الثانية', THREE: 'النوبة الثالثة' }

interface Member {
  id: string
  name: string
  employeeCode: string | null
  weeklyOffDay: number | null
}

interface Spare {
  id: string
  name: string
  employeeCode: string | null
  weeklyOffDay: number | null
  leaveGroupId: string | null
}

interface Group {
  id: string
  name: string
  shiftNumber: ShiftNum
  coverUserId: string | null
  coverUser: { id: string; name: string; employeeCode: string | null } | null
  members: Member[]
}

interface PerShift { groups: Group[]; spares: Spare[] }

export function LeaveGroupsSection() {
  const confirm = useConfirm()
  const prompt = usePrompt()
  const toast = useToast()
  const [active, setActive] = useState<ShiftNum>('ONE')
  const [perShift, setPerShift] = useState<Record<ShiftNum, PerShift> | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setMsg('')
    try {
      const r = await fetch('/api/manager/leave-groups').then(x => x.json())
      if (!r.success) throw new Error(r.error || 'فشل التحميل')
      setPerShift(r.perShift)
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function createGroup() {
    const name = await prompt({
      title: 'مجموعة جديدة',
      label: 'اسم المجموعة',
      placeholder: 'مثلاً: المجموعة D',
      confirmLabel: 'إنشاء',
    })
    if (!name) return
    try {
      const r = await fetch('/api/leave-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), shiftNumber: active }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      await load()
      toast('تم إنشاء المجموعة', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function autoGenerate() {
    const shiftLabel = SHIFT_LABELS[active]
    const existingCount = perShift?.[active]?.groups.length ?? 0
    const message = existingCount > 0
      ? `سيتم حذف ${existingCount} مجموعة قائمة واستبدالها.\n\nالقاعدة:\n• K مجموعة = ceil(N / 7)\n• K سبير (مغطّي واحد لكل مجموعة)\n• توزيع باقي الموظفين بالتساوي (سقف 6/مجموعة)`
      : `القاعدة:\n• K مجموعة = ceil(N / 7)\n• K سبير (مغطّي واحد لكل مجموعة)\n• توزيع باقي الموظفين بالتساوي (سقف 6/مجموعة)`
    const ok = await confirm({
      title: `توليد تلقائي — ${shiftLabel}`,
      message,
      confirmLabel: 'توليد',
      danger: existingCount > 0,
    })
    if (!ok) return
    try {
      const r = await fetch('/api/leave-groups/auto-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftNumber: active, replace: true }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      toast(`تمّ توليد ${d.created} مجموعة (${d.distribution.join(' + ')}) + ${d.spares} سبير من أصل ${d.totalEmployees} موظف`, 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function updateGroup(id: string, patch: Record<string, unknown>) {
    try {
      const r = await fetch(`/api/leave-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      await load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function deleteGroup(id: string) {
    const ok = await confirm({
      title: 'حذف المجموعة',
      message: 'أعضاؤها سيعودون إلى قائمة السبير.',
      danger: true,
      confirmLabel: 'حذف',
    })
    if (!ok) return
    try {
      const r = await fetch(`/api/leave-groups/${id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      toast('تم حذف المجموعة', 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function updateEmployee(userId: string, patch: Record<string, unknown>) {
    try {
      const r = await fetch('/api/employees', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, ...patch }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)
      await load()
    } catch (e) {
      setMsg('خطأ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const shift = perShift?.[active]

  return (
    <div className="card p-4 space-y-4 mt-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={16} className="text-blue-600" />
        <h2 className="text-sm font-bold text-gray-800">مجموعات الإجازات لكل نوبة</h2>
        <button
          onClick={autoGenerate}
          className="btn-primary btn-sm mr-auto inline-flex items-center gap-1"
          title="توليد المجموعات تلقائياً لهذه النوبة"
        >
          <Sparkles size={13} />
          توليد تلقائي
        </button>
        <button onClick={load} className="btn-secondary btn-sm">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          تحديث
        </button>
      </div>

      {/* Explainer */}
      <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 text-xs text-blue-900 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info size={12} /> كيف تعمل الإجازات والتغطية
        </div>
        <ul className="space-y-0.5 mr-4 list-disc leading-relaxed">
          <li>كل نوبة تُقسَّم إلى مجموعات (بحد أقصى 6 أعضاء) + موظفي سبير.</li>
          <li>كل مجموعة لها <b>مغطّي واحد ثابت</b> من السبير — يستلم عمل أي عضو يأخذ إجازة.</li>
          <li>يوم إجازة كل عضو ثابت أسبوعياً. لا يجوز يومان متتاليان لعضوَين من نفس المجموعة.</li>
          <li>مثال أحجام: 9 → مجموعتان (3+4) و2 سبير · 14 → مجموعتان بست و2 سبير.</li>
        </ul>
      </div>

      {/* Shift tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {(['ONE', 'TWO', 'THREE'] as ShiftNum[]).map(sn => (
          <button
            key={sn}
            onClick={() => setActive(sn)}
            className={`px-3 py-2 text-sm rounded-t-lg border-b-2 transition-colors ${
              active === sn
                ? 'border-blue-600 text-blue-700 font-semibold bg-blue-50/40'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            {SHIFT_LABELS[sn]}
            <span className="text-[10px] text-gray-400 mr-1">
              ({perShift?.[sn]?.groups.length ?? 0})
            </span>
          </button>
        ))}
      </div>

      {msg && (
        <div className={`text-xs rounded-lg px-3 py-2 ${msg.startsWith('خطأ') ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg}
        </div>
      )}

      {loading && !perShift && (
        <div className="p-8 text-center text-gray-400 text-sm">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" /> جاري التحميل...
        </div>
      )}

      {shift && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Groups column */}
          <div className="lg:col-span-2 space-y-3">
            {shift.groups.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                لا مجموعات لهذه النوبة بعد.
              </div>
            )}
            {shift.groups.map(g => (
              <GroupCard
                key={g.id}
                group={g}
                spares={shift.spares}
                onUpdateGroup={patch => updateGroup(g.id, patch)}
                onDeleteGroup={() => deleteGroup(g.id)}
                onUpdateEmployee={updateEmployee}
              />
            ))}
            <button onClick={createGroup} className="btn-secondary btn-sm w-full inline-flex items-center justify-center gap-2 border-dashed">
              <Plus size={14} /> مجموعة جديدة
            </button>
          </div>

          {/* Spares column */}
          <SparesPanel
            spares={shift.spares}
            groups={shift.groups}
            onAssign={(uid, gid) => updateEmployee(uid, { leaveGroupId: gid })}
          />
        </div>
      )}
    </div>
  )
}

// ─── Group card ────────────────────────────────────────────────────────

function GroupCard({
  group, spares, onUpdateGroup, onDeleteGroup, onUpdateEmployee,
}: {
  group: Group
  spares: Spare[]
  onUpdateGroup: (patch: Record<string, unknown>) => void
  onDeleteGroup: () => void
  onUpdateEmployee: (userId: string, patch: Record<string, unknown>) => void
}) {
  const [name, setName] = useState(group.name)
  useEffect(() => { setName(group.name) }, [group.name])

  const memberIds = new Set(group.members.map(m => m.id))
  const available = spares.filter(s => !memberIds.has(s.id))

  function saveName() {
    if (name.trim() && name.trim() !== group.name) onUpdateGroup({ name: name.trim() })
  }

  function addMember(uid: string) {
    if (!uid) return
    if (group.members.length >= 6) return
    if (uid === group.coverUserId) return // cover can't also be member
    const nextIds = [...group.members.map(m => m.id), uid]
    onUpdateGroup({ memberIds: nextIds })
  }
  function removeMember(uid: string) {
    const nextIds = group.members.filter(m => m.id !== uid).map(m => m.id)
    onUpdateGroup({ memberIds: nextIds })
  }
  function setCover(uid: string) {
    onUpdateGroup({ coverUserId: uid || null })
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          className="input py-1 text-sm font-semibold max-w-[160px]"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        <span className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${group.members.length >= 6 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {group.members.length} / 6
        </span>
        <button
          onClick={onDeleteGroup}
          className="btn-ghost btn-sm text-rose-600 mr-auto"
          title="حذف المجموعة"
        >
          <X size={14} />
        </button>
      </div>

      {/* Cover chooser */}
      <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-100 rounded-lg p-2">
        <Shield size={14} className="text-emerald-700 shrink-0" />
        <span className="text-xs text-emerald-800 font-semibold">المغطّي:</span>
        <select
          className="input py-1 text-xs flex-1"
          value={group.coverUserId ?? ''}
          onChange={e => setCover(e.target.value)}
        >
          <option value="">— بلا مغطّي —</option>
          {group.coverUser && (
            <option value={group.coverUser.id}>{group.coverUser.name}</option>
          )}
          {available.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Members */}
      <div className="space-y-1.5">
        {group.members.length === 0 && (
          <p className="text-xs text-gray-400 py-2 text-center">لا أعضاء بعد.</p>
        )}
        {group.members.map(m => (
          <div key={m.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg p-2">
            <span className="flex-1 font-medium truncate">{m.name}</span>
            <select
              className="input py-1 text-xs w-24"
              value={m.weeklyOffDay ?? ''}
              onChange={e => onUpdateEmployee(m.id, { weeklyOffDay: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
              title="يوم الإجازة الأسبوعي"
            >
              <option value="">—</option>
              {DAY_NAMES.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
            <button
              onClick={() => removeMember(m.id)}
              className="btn-ghost btn-sm text-rose-500"
              title="إخراج من المجموعة"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Add member */}
      {group.members.length < 6 && (
        <select
          className="input py-1 text-xs w-full"
          value=""
          onChange={e => addMember(e.target.value)}
        >
          <option value="">+ إضافة عضو من السبير</option>
          {available.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {group.members.length >= 6 && (
        <p className="text-[10px] text-amber-700 inline-flex items-center gap-1">
          <AlertTriangle size={11} /> بلغت السقف
        </p>
      )}
    </div>
  )
}

// ─── Spares panel ──────────────────────────────────────────────────────

function SparesPanel({
  spares, groups, onAssign,
}: {
  spares: Spare[]
  groups: Group[]
  onAssign: (userId: string, groupId: string) => void
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-gradient-to-bl from-slate-50 to-white">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-slate-600" />
        <h3 className="text-sm font-bold text-slate-700">السبير — بلا مجموعة</h3>
        <span className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 mr-auto">
          {spares.length}
        </span>
      </div>
      {spares.length === 0 ? (
        <p className="text-xs text-gray-400 py-2 text-center">لا موظفي سبير في هذه النوبة.</p>
      ) : (
        <div className="space-y-1.5">
          {spares.map(s => (
            <div key={s.id} className="flex items-center gap-2 text-xs bg-white border border-gray-100 rounded-lg p-2">
              <span className="flex-1 font-medium truncate">{s.name}</span>
              <select
                className="input py-1 text-[11px] w-28"
                value=""
                onChange={e => e.target.value && onAssign(s.id, e.target.value)}
              >
                <option value="">إسناد إلى…</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id} disabled={g.members.length >= 6}>
                    {g.name}{g.members.length >= 6 ? ' (ممتلئة)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
