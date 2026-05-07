// Atomic permission keys — every protected action in the system maps to one
// of these. New features must add their key here BEFORE wiring the check.
//
// Naming: <module>.<action> — kebab-case for actions if needed.

export const PERMISSIONS = {
  // ── المطابقة (Reconciliation) ──
  TRANSACTIONS_VIEW:        'transactions.view',
  TRANSACTIONS_EDIT:        'transactions.edit',
  TRANSACTIONS_REVIEW:      'transactions.review',
  RECONCILIATION_UPLOAD:    'reconciliation.upload',
  RECONCILIATION_CONSOLID:  'reconciliation.consolidate',

  // ── المالية (Finance) ──
  PROFITS_VIEW:             'profits.view',
  EXPENSES_VIEW:            'expenses.view',
  EXPENSES_CREATE:          'expenses.create',
  EXPENSES_EDIT:            'expenses.edit',
  EXPENSES_DELETE:          'expenses.delete',

  // ── السجلات المرجعية ──
  ACCOUNTS_VIEW:            'accounts.view',
  ACCOUNTS_MANAGE:          'accounts.manage',
  CUSTOMERS_VIEW:           'customers.view',

  // ── الموارد البشرية ──
  EMPLOYEES_VIEW:           'employees.view',
  EMPLOYEES_CREATE:         'employees.create',
  EMPLOYEES_EDIT:           'employees.edit',
  EMPLOYEES_DELETE:         'employees.delete',
  SHIFTS_CHECKIN:           'shifts.checkin',
  SHIFTS_APPROVE_HANDOVER:  'shifts.approve_handover',
  ATTENDANCE_VIEW_ALL:      'attendance.view_all',
  SCHEDULE_VIEW:            'schedule.view',
  SCHEDULE_EDIT:            'schedule.edit',
  PAYROLL_VIEW:             'payroll.view',
  PAYROLL_ADJUST:           'payroll.adjust',
  PAYROLL_PAY:              'payroll.pay',
  BONUSES_ADD:              'bonuses.add',

  // ── النظام ──
  USERS_MANAGE:             'users.manage',
  ROLES_MANAGE:             'roles.manage',
  SETTINGS_EDIT:            'settings.edit',
  AUDIT_VIEW:               'audit.view',
} as const

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// Display metadata grouped by category — used by the /roles permission matrix
export const PERMISSION_CATEGORIES: Array<{
  title: string
  keys: Array<{ key: PermissionKey; label: string }>
}> = [
  {
    title: 'المطابقة والعمليات',
    keys: [
      { key: PERMISSIONS.TRANSACTIONS_VIEW,        label: 'عرض العمليات' },
      { key: PERMISSIONS.TRANSACTIONS_EDIT,        label: 'تعديل العمليات' },
      { key: PERMISSIONS.TRANSACTIONS_REVIEW,      label: 'مراجعة وتصنيف' },
      { key: PERMISSIONS.RECONCILIATION_UPLOAD,    label: 'رفع ملفات المطابقة' },
      { key: PERMISSIONS.RECONCILIATION_CONSOLID,  label: 'دمج العمليات' },
    ],
  },
  {
    title: 'المالية',
    keys: [
      { key: PERMISSIONS.PROFITS_VIEW,    label: 'عرض الأرباح' },
      { key: PERMISSIONS.EXPENSES_VIEW,   label: 'عرض الصرفيات' },
      { key: PERMISSIONS.EXPENSES_CREATE, label: 'إضافة صرفية' },
      { key: PERMISSIONS.EXPENSES_EDIT,   label: 'تعديل صرفية' },
      { key: PERMISSIONS.EXPENSES_DELETE, label: 'حذف صرفية' },
    ],
  },
  {
    title: 'السجلات المرجعية',
    keys: [
      { key: PERMISSIONS.ACCOUNTS_VIEW,   label: 'عرض الحسابات' },
      { key: PERMISSIONS.ACCOUNTS_MANAGE, label: 'إدارة الحسابات' },
      { key: PERMISSIONS.CUSTOMERS_VIEW,  label: 'عرض العملاء' },
    ],
  },
  {
    title: 'الموارد البشرية',
    keys: [
      { key: PERMISSIONS.EMPLOYEES_VIEW,           label: 'عرض الموظفين' },
      { key: PERMISSIONS.EMPLOYEES_CREATE,         label: 'إضافة موظف' },
      { key: PERMISSIONS.EMPLOYEES_EDIT,           label: 'تعديل موظف' },
      { key: PERMISSIONS.EMPLOYEES_DELETE,         label: 'تعطيل موظف' },
      { key: PERMISSIONS.SHIFTS_CHECKIN,           label: 'تسجيل دخول/خروج' },
      { key: PERMISSIONS.SHIFTS_APPROVE_HANDOVER,  label: 'اعتماد التسليم' },
      { key: PERMISSIONS.ATTENDANCE_VIEW_ALL,      label: 'عرض دوام الجميع' },
      { key: PERMISSIONS.SCHEDULE_VIEW,            label: 'عرض جدول المناوبات' },
      { key: PERMISSIONS.SCHEDULE_EDIT,            label: 'تعديل الجدول' },
      { key: PERMISSIONS.PAYROLL_VIEW,             label: 'عرض الرواتب' },
      { key: PERMISSIONS.PAYROLL_ADJUST,           label: 'تعديل الرواتب' },
      { key: PERMISSIONS.PAYROLL_PAY,              label: 'دفع الرواتب' },
      { key: PERMISSIONS.BONUSES_ADD,              label: 'إضافة مكافآت' },
    ],
  },
  {
    title: 'النظام',
    keys: [
      { key: PERMISSIONS.USERS_MANAGE,    label: 'إدارة الحسابات' },
      { key: PERMISSIONS.ROLES_MANAGE,    label: 'إدارة الأدوار' },
      { key: PERMISSIONS.SETTINGS_EDIT,   label: 'تعديل الإعدادات' },
      { key: PERMISSIONS.AUDIT_VIEW,      label: 'سجل التدقيق' },
    ],
  },
]
