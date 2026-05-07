'use client'
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Shield, ShieldCheck, ShieldAlert, Plus, X, Save, Trash2, Edit2, HelpCircle, ChevronDown } from 'lucide-react'
import { PERMISSION_CATEGORIES } from '@/lib/permissions/keys'

interface RoleDTO {
  id: string
  name: string
  displayName: string
  description: string | null
  isSystemRole: boolean
  isActive: boolean
  permissions: string[]
  isLegacy?: boolean
  assignedCount?: number
}

const ALL_PERM_KEYS = PERMISSION_CATEGORIES.flatMap(c => c.keys.map(k => k.key))

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<RoleDTO | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<{
    id?: string; name: string; displayName: string; description: string;
    permissions: Set<string>;
  }>({ name: '', displayName: '', description: '', permissions: new Set() })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/roles')
    const d = await r.json()
    if (d.success) setRoles(d.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', displayName: '', description: '', permissions: new Set() })
    setError(''); setShowForm(true)
  }
  function openEdit(role: RoleDTO) {
    if (role.isLegacy) {
      alert('الأدوار الافتراضية للقراءة فقط. أنشئ دوراً مخصّصاً لتعديله.')
      return
    }
    setEditing(role)
    setForm({
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description || '',
      permissions: new Set(role.permissions),
    })
    setError(''); setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        displayName: form.displayName,
        description: form.description || undefined,
        permissions: Array.from(form.permissions),
      }
      const res = await fetch('/api/roles', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!d.success) {
        if (res.status === 503) setNeedsMigration(true)
        throw new Error(d.error || 'فشل الحفظ')
      }
      setShowForm(false); load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  async function handleDelete(role: RoleDTO) {
    if (role.isLegacy) return
    if (!confirm(`حذف الدور "${role.displayName}"؟ سيُسحب من ${role.assignedCount || 0} موظف.`)) return
    const res = await fetch(`/api/roles?id=${role.id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!d.success) { alert('خطأ: ' + d.error); return }
    load()
  }

  function togglePerm(key: string) {
    setForm(f => {
      const n = new Set(f.permissions)
      if (n.has(key)) n.delete(key); else n.add(key)
      return { ...f, permissions: n }
    })
  }

  function selectAllInCategory(catTitle: string) {
    const cat = PERMISSION_CATEGORIES.find(c => c.title === catTitle)
    if (!cat) return
    setForm(f => {
      const n = new Set(f.permissions)
      const allInCat = cat.keys.every(k => n.has(k.key))
      for (const k of cat.keys) {
        if (allInCat) n.delete(k.key); else n.add(k.key)
      }
      return { ...f, permissions: n }
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الأدوار والصلاحيات</h1>
          <p className="text-sm text-gray-500 mt-0.5">إدارة الأدوار المخصّصة وتحديد صلاحيات كل دور</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setGuideOpen(g => !g)} className="btn-secondary btn-sm" title="دليل الاستخدام">
            <HelpCircle size={14} /> دليل
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} /> دور جديد
          </button>
        </div>
      </div>

      {/* ── دليل الاستخدام ── */}
      <div className={`card overflow-hidden transition-all duration-300 ${guideOpen ? 'opacity-100' : 'opacity-100'}`}>
        <button
          onClick={() => setGuideOpen(g => !g)}
          className="w-full flex items-center justify-between p-4 hover:bg-blue-50/40 transition-colors"
        >
          <div className="flex items-center gap-2 text-right">
            <HelpCircle size={16} className="text-blue-500" />
            <div>
              <p className="font-bold text-gray-800 text-sm">كيف يعمل نظام الأدوار؟</p>
              <p className="text-[11px] text-gray-500">شرح موجز للأدوار، الصلاحيات، وكيفية إنشاء دور مخصّص</p>
            </div>
          </div>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
        </button>
        {guideOpen && (
          <div className="border-t border-gray-100 p-5 space-y-4 text-sm text-gray-700 leading-relaxed">

            <section>
              <h3 className="font-bold text-gray-900 mb-1.5 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">١</span>
                ما الفرق بين الدور والصلاحية؟
              </h3>
              <ul className="space-y-1 pr-7 text-gray-600 list-disc list-inside">
                <li><b className="text-gray-900">الصلاحية:</b> إجراء واحد محدّد (مثلاً: <code className="text-[11px] bg-gray-100 px-1 rounded">payroll.pay</code> = دفع راتب).</li>
                <li><b className="text-gray-900">الدور:</b> مجموعة صلاحيات تُمنح لمجموعة موظفين (مثلاً: <i>مدير فرع</i>).</li>
              </ul>
            </section>

            <section>
              <h3 className="font-bold text-gray-900 mb-1.5 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">٢</span>
                نوعا الأدوار
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-7">
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield size={14} className="text-gray-400" />
                    <span className="font-bold text-gray-900">أدوار افتراضية</span>
                    <span className="badge bg-gray-200 text-gray-600 text-[9px]">مدمجة</span>
                  </div>
                  <p className="text-xs text-gray-600">٥ أدوار مدمجة (مدير عام، مدير فرع، مشرف، ...). للقراءة فقط — لا يمكن تعديل صلاحياتها أو حذفها.</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    <span className="font-bold text-gray-900">أدوار مخصّصة</span>
                    <span className="badge bg-emerald-200 text-emerald-700 text-[9px]">قابلة للتعديل</span>
                  </div>
                  <p className="text-xs text-gray-600">تُنشئها أنت بأي صلاحيات تختارها. يمكن تعديلها أو حذفها لاحقاً.</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="font-bold text-gray-900 mb-1.5 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">٣</span>
                إنشاء دور مخصّص — خطوة بخطوة
              </h3>
              <ol className="space-y-1.5 pr-7 text-gray-600 list-decimal list-inside">
                <li>اضغط <b className="text-gray-900">"دور جديد"</b> في الأعلى.</li>
                <li>أدخل <b>المعرّف</b> بأحرف كبيرة وشُرَط (مثل <code className="text-[11px] bg-gray-100 px-1 rounded">BRANCH_LEAD</code>) — هذا المعرّف لا يتغيّر لاحقاً.</li>
                <li>أدخل <b>الاسم المعروض</b> الذي سيراه المستخدمون (مثل: <i>"رئيس فرع شام"</i>).</li>
                <li>اختر الصلاحيات من المصفوفة المُجمَّعة في ٥ فئات. يمكنك ضغط <b>"تحديد الكل"</b> لتفعيل/إلغاء فئة كاملة.</li>
                <li>احفظ — يصبح الدور متاحاً لإسناده إلى الموظفين.</li>
              </ol>
            </section>

            <section>
              <h3 className="font-bold text-gray-900 mb-1.5 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">٤</span>
                أمثلة عملية
              </h3>
              <div className="space-y-2 pr-7">
                <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-200 text-xs">
                  <p className="font-bold text-amber-900 mb-0.5">دور "محاسب رواتب"</p>
                  <p className="text-amber-800">يحتاج فقط: <code className="bg-white/60 px-1 rounded text-[10px]">payroll.view</code>، <code className="bg-white/60 px-1 rounded text-[10px]">payroll.adjust</code>، <code className="bg-white/60 px-1 rounded text-[10px]">payroll.pay</code> — بدون صلاحيات حسابات أو موظفين.</p>
                </div>
                <div className="bg-sky-50 rounded-lg p-2.5 border border-sky-200 text-xs">
                  <p className="font-bold text-sky-900 mb-0.5">دور "متابع دوام"</p>
                  <p className="text-sky-800">يكفيه: <code className="bg-white/60 px-1 rounded text-[10px]">attendance.view_all</code>، <code className="bg-white/60 px-1 rounded text-[10px]">shifts.approve_handover</code> — يراقب الحضور دون تعديل.</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-2.5 border border-purple-200 text-xs">
                  <p className="font-bold text-purple-900 mb-0.5">دور "محاسب جزئي"</p>
                  <p className="text-purple-800">يأخذ صلاحيات المالية فقط (<code className="bg-white/60 px-1 rounded text-[10px]">profits.view</code>، <code className="bg-white/60 px-1 rounded text-[10px]">expenses.*</code>) دون الموارد البشرية.</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="font-bold text-gray-900 mb-1.5 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">٥</span>
                ملاحظات مهمة
              </h3>
              <ul className="space-y-1 pr-7 text-gray-600 list-disc list-inside text-xs">
                <li>تعطيل دور (<ShieldAlert size={11} className="inline text-amber-500" />) يُلغي صلاحياته فوراً عن كل موظف يحمله.</li>
                <li>حذف دور يفصله عن جميع الموظفين المرتبطين به دون حذفهم.</li>
                <li>المعرّف يجب أن يكون فريداً ولا يحتوي مسافات.</li>
                <li>الصلاحيات الذرّية الكلية: <b className="text-gray-900">{ALL_PERM_KEYS.length} صلاحية</b> عبر <b className="text-gray-900">٥ فئات</b>.</li>
              </ul>
            </section>

          </div>
        )}
      </div>

      {needsMigration && (
        <div className="card p-4 bg-amber-50 border-r-4 border-amber-500 text-amber-900 text-sm">
          <p className="font-bold">⚠️ خطوة إضافية مطلوبة</p>
          <p className="mt-1">لتفعيل إنشاء أدوار مخصّصة، شغّل من سطر الأوامر: <code className="bg-white/60 px-2 py-0.5 rounded">npx prisma db push --skip-generate</code></p>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2" /> جاري التحميل...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {roles.map(role => (
            <div key={role.id} className={`card p-4 ${!role.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {role.isLegacy
                    ? <Shield size={18} className="text-gray-400" />
                    : role.isActive
                      ? <ShieldCheck size={18} className="text-emerald-500" />
                      : <ShieldAlert size={18} className="text-amber-500" />
                  }
                  <div>
                    <h3 className="font-bold text-gray-900">{role.displayName}</h3>
                    <p className="text-[10px] text-gray-400 font-mono">{role.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {role.isLegacy ? (
                    <span className="badge bg-gray-100 text-gray-600 text-[10px]">افتراضي</span>
                  ) : (
                    <>
                      <button onClick={() => openEdit(role)} className="btn-ghost p-1.5 text-blue-600" title="تعديل">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(role)} className="btn-ghost p-1.5 text-rose-600" title="حذف">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {role.description && <p className="text-xs text-gray-500 mt-1">{role.description}</p>}
              <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500">
                <span><span className="font-bold text-gray-700">{role.permissions.length}</span> صلاحية</span>
                {!role.isLegacy && (
                  <span><span className="font-bold text-gray-700">{role.assignedCount || 0}</span> موظف</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-2 max-h-20 overflow-y-auto">
                {role.permissions.slice(0, 8).map(p => (
                  <span key={p} className="badge bg-blue-50 text-blue-700 text-[9px] font-mono">{p}</span>
                ))}
                {role.permissions.length > 8 && (
                  <span className="badge bg-gray-100 text-gray-500 text-[9px]">+{role.permissions.length - 8}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 sticky top-0 bg-white flex items-center justify-between z-10">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Shield size={18} /> {editing ? 'تعديل دور' : 'دور جديد'}
              </h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المعرّف *</label>
                  <input className="input font-mono" required value={form.name}
                    placeholder="BRANCH_LEAD"
                    disabled={!!editing}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الاسم المعروض *</label>
                  <input className="input" required value={form.displayName}
                    placeholder="رئيس فرع"
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
                  <input className="input" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  الصلاحيات ({form.permissions.size} / {ALL_PERM_KEYS.length})
                </p>
                <div className="space-y-3 border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                  {PERMISSION_CATEGORIES.map(cat => {
                    const allChecked = cat.keys.every(k => form.permissions.has(k.key))
                    const someChecked = cat.keys.some(k => form.permissions.has(k.key))
                    return (
                      <div key={cat.title} className="bg-white rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                          <h4 className="font-bold text-sm text-gray-700">{cat.title}</h4>
                          <button type="button" onClick={() => selectAllInCategory(cat.title)}
                            className="text-[11px] text-blue-600 hover:underline">
                            {allChecked ? 'إلغاء الكل' : someChecked ? 'تحديد الكل' : 'تحديد الكل'}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {cat.keys.map(p => (
                            <label key={p.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-blue-50 cursor-pointer text-sm">
                              <input type="checkbox" checked={form.permissions.has(p.key)}
                                onChange={() => togglePerm(p.key)} />
                              <span className="text-gray-700">{p.label}</span>
                              <span className="text-[9px] text-gray-300 font-mono mr-auto">{p.key}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1 justify-center">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
