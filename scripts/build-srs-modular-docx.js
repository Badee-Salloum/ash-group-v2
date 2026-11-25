// Build a modular SRS proposal (.docx) — each section has its own price and
// development duration, so the client can cherry-pick. Total if all selected:
// 5,000 USD over 6 weeks; can shrink to ~2 weeks if minimal modules only.
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, LevelFormat, BorderStyle, WidthType, ShadingType,
} = require('docx')

// ── Design tokens (matching reference doc) ───────────────────────────────
const FONT_LATIN = 'Arial'
const FONT_ARABIC = 'Arial'
const COL_TITLE_NAVY = '1f4e79'
const COL_SUBTITLE_GRAY = '7f8c8d'
const COL_NAVY_DARK = '2c3e50'
const COL_BODY = '333333'
const COL_H4_BLUE = '2e74b5'
const COL_BORDER = 'bdc3c7'
const COL_SHADE = 'f2f2f2'
const COL_ACCENT = 'c9982e' // gold for price

// ── helpers ───────────────────────────────────────────────────────────────
function ar(text, opts = {}) {
  return new TextRun({
    text,
    font: { name: FONT_LATIN, cs: FONT_ARABIC },
    size: opts.size || 24,
    color: opts.color || COL_BODY,
    bold: opts.bold,
    italics: opts.italics,
    rightToLeft: true,
    language: { value: 'ar-SY', bidi: 'ar-SY' },
  })
}
function en(text, opts = {}) {
  return new TextRun({
    text,
    font: FONT_LATIN,
    size: opts.size || 24,
    color: opts.color || COL_BODY,
    bold: opts.bold,
    italics: opts.italics,
  })
}
function P(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 140, before: 0, line: 340, lineRule: 'auto' },
    ...opts.para,
    children: [ar(text, opts)],
  })
}
function H1(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 220, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 36, bold: true, color: COL_TITLE_NAVY })],
  })
}
function H2(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 180, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 30, bold: true, color: opts.color || COL_NAVY_DARK })],
  })
}
function H3(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 140, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 26, bold: true, color: '000000' })],
  })
}
function B(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 90, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 24 })],
  })
}
function Empty() {
  return new Paragraph({ bidirectional: true, spacing: { before: 0, after: 0 }, children: [] })
}

const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: COL_BORDER }
const allBorders = {
  top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder,
  insideHorizontal: tableBorder, insideVertical: tableBorder,
}

function tcell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 100, bottom: 100, left: 180, right: 180 },
    verticalAlign: 'center',
    children: [new Paragraph({
      bidirectional: true,
      alignment: opts.align || AlignmentType.RIGHT,
      spacing: { before: 0, after: 0, line: 300, lineRule: 'auto' },
      children: [ar(String(text), {
        size: 22,
        color: opts.color || (opts.bold ? COL_TITLE_NAVY : COL_BODY),
        bold: !!opts.bold,
      })],
    })],
  })
}
function makeTable(widths, rows, opts = {}) {
  const total = widths.reduce((a, b) => a + b, 0)
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: allBorders,
    visuallyRightToLeft: true,
    alignment: AlignmentType.RIGHT,
    rows: rows.map((r, i) =>
      new TableRow({
        children: r.map((txt, j) => tcell(txt, {
          width: widths[j],
          shading: i === 0 ? COL_SHADE : (opts.stripe && i % 2 === 0 ? COL_SHADE : undefined),
          bold: i === 0 || (opts.boldCol && opts.boldCol.includes(j)),
          align: opts.centerCols && opts.centerCols.includes(j) ? AlignmentType.CENTER : AlignmentType.RIGHT,
          color: i === 0 ? undefined : (opts.priceCol === j ? COL_ACCENT : undefined),
        })),
      })
    ),
  })
}

// ── Module definitions ────────────────────────────────────────────────────
const modules = [
  {
    id: 'A',
    title: 'نظام إدارة الموظفين الأساسي',
    desc: 'ملف موظف كامل وشجرة هيكل تنظيمي مع علاقات هرمية.',
    items: [
      'توسعة حساب المستخدم الحالي ليشمل رمز الموظف والمسمى الوظيفي وتاريخ التعيين والراتب الأساسي.',
      'ربط كل موظف بمدير مباشر واحد مع دعم عدة مرؤوسين.',
      'صفحة "الهيكل التنظيمي" بعرض شجري بصري.',
      'صورة شخصية، رقم هاتف، عنوان.',
    ],
    days: 3,
    price: 450,
  },
  {
    id: 'B',
    title: 'تسجيل الدخول والخروج مع تبديل المناوبات',
    desc: 'نظام Check-in/Check-out مع آلية تبديل آمنة بين الموظفين.',
    items: [
      'ثلاث مناوبات × ثمان ساعات (تبدأ الأولى السادسة صباحاً).',
      'آلية تبديل المناوبة: طلب خروج + طلب دخول يُقبلان معاً.',
      'سجل جلسات عمل كامل مع مدة كل جلسة.',
      'منع بدء مناوبة قبل تأكيد تسليم الموظف السابق.',
    ],
    days: 3,
    price: 450,
  },
  {
    id: 'C',
    title: 'اختيار المحافظ لكل جلسة',
    desc: 'ربط كل جلسة عمل بمجموعة محافظ يختارها الموظف.',
    items: [
      'قائمة محافظ مسموحة لكل موظف (يضبطها المدير).',
      'عند تسجيل الدخول يحدد الموظف المحافظ التي سيعمل عليها.',
      'كل عملية تُربط بالجلسة والمحفظة.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'D',
    title: 'ربط العمليات المالية بالموظفين',
    desc: 'توزيع تلقائي للعمليات المالية على الموظف المسؤول عنها.',
    items: [
      'مطابقة تلقائية بين جلسة العمل والعملية (الوقت + المحفظة).',
      'زر "إعادة ربط تاريخي" للعمليات السابقة.',
      'تقارير أداء الموظف (نسبة المطابقة، عدد العمليات، متوسط الفارق).',
      'تقارير المحفظة (من عمل عليها ومتى).',
    ],
    days: 2,
    price: 400,
  },
  {
    id: 'E',
    title: 'جدولة المناوبات الأسبوعية',
    desc: 'توزيع تلقائي للموظفين مع اقتراح أيام العطلة.',
    items: [
      'خوارزمية توزّع الموظفين على ثلاث مناوبات × سبعة أيام.',
      'مراعاة الحد الأدنى لكل مناوبة، الإجازات المعتمدة، والتوزيع العادل.',
      'تقويم أسبوعي بصري مع تعديل يدوي بالسحب والإفلات.',
      'تصدير PDF للطباعة.',
    ],
    days: 2,
    price: 400,
  },
  {
    id: 'F',
    title: 'إدارة الإجازات',
    desc: 'طلب/موافقة مع رصيد سنوي وتأثير على الجدول.',
    items: [
      'أنواع: سنوية، مرضية، طارئة، بدون راتب.',
      'سير موافقة مع المدير المباشر.',
      'انعكاس تلقائي على جدول المناوبات.',
      'رصيد إجازات سنوي قابل للضبط.',
    ],
    days: 2,
    price: 250,
  },
  {
    id: 'G',
    title: 'نظام الرواتب الأسبوعي',
    desc: 'احتساب أسبوعي تلقائي مع الساعات الفعلية والخصومات.',
    items: [
      'احتساب كل جمعة (قابل للتخصيص).',
      'المعادلة: الأساسي × (الساعات الفعلية ÷ المتوقعة) + المكافآت − السلف − الخصومات.',
      'سجل مستقل لكل فترة راتب.',
      'تقرير شامل قابل للتصدير.',
    ],
    days: 3,
    price: 450,
  },
  {
    id: 'H',
    title: 'طلبات السلف',
    desc: 'تقديم السلفة عبر المنصة مع سير موافقة.',
    items: [
      'طلب مع مبلغ وسبب.',
      'موافقة المدير ← خصم تلقائي من راتب الأسبوع.',
      'حد أقصى قابل للضبط (افتراضياً 50%).',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'I',
    title: 'المكافآت التراكمية',
    desc: 'مكافأة تكبر كل أسبوع بلا أخطاء وتصفّر عند أي خطأ.',
    items: [
      'قيمة ثابتة تُضاف كل أسبوع نظيف.',
      'تصفير فوري عند أي خطأ مصنّف (سرقة / خطأ موظف).',
      'تعديل يدوي من المدير مع سبب مسجّل.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'J',
    title: 'المكافآت الجماعية',
    desc: 'إضافة مكافأة لمجموعة موظفين بنقرة واحدة.',
    items: [
      'اختيار موظفين (checkbox) أو "كل الفريق".',
      'مبلغ لكل موظف + سبب.',
      'إضافة دفعية واحدة لراتب الأسبوع الحالي.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'K',
    title: 'لوحة الموظف الشخصية',
    desc: 'واجهة تعرض راتبه وعملياته وأخطاءه وإجازاته.',
    items: [
      'الراتب الحالي + آخر أربعة رواتب.',
      'عدد العمليات المنجزة (أسبوعياً / شهرياً).',
      'عدد الأخطاء المنسوبة + المكافأة التراكمية.',
      'رصيد الإجازات + زر تسجيل دخول/خروج بارز.',
    ],
    days: 2,
    price: 300,
  },
  {
    id: 'L',
    title: 'الإشعارات الذكية',
    desc: 'تنبيهات داخل المنصة للأحداث المهمة.',
    items: [
      'جرس في الشريط العلوي مع عداد.',
      'تنبيهات: طلبات الموافقات، الراتب جاهز، خطأ جديد، تنبيه مناوبة، رسائل.',
      'تفضيلات لكل مستخدم.',
    ],
    days: 2,
    price: 250,
  },
  {
    id: 'M',
    title: 'إشعارات Push خارج المتصفح',
    desc: 'Web Push تصل للجهاز حتى لو كان المتصفح مغلقاً.',
    items: [
      'Web Push API + Service Worker.',
      'يعمل على Desktop وموبايل Android.',
      'تحكم المستخدم بأنواع الإشعارات.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'N',
    title: 'البحث الشامل',
    desc: 'شريط بحث ثابت يبحث في كل الموقع (Ctrl+K).',
    items: [
      'بحث في: الموظفين، العمليات المالية، المحافظ، الرسائل، السجلات.',
      'نتائج مجمعة بأقسام مع روابط مباشرة.',
    ],
    days: 1,
    price: 200,
  },
  {
    id: 'O',
    title: 'حظر عناوين IP',
    desc: 'منع الدخول من عناوين محددة مع حظر تلقائي.',
    items: [
      'قائمة محظورين يديرها المدير (إضافة/إزالة/انتهاء).',
      'Middleware يرفض الطلبات من IP محظور.',
      'حظر تلقائي بعد 5 محاولات دخول فاشلة.',
      'Whitelist اختيارية لكل مستخدم.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'P',
    title: 'تاريخ التعديلات الكامل',
    desc: 'سجل شامل لكل تغيير على أي بيان (قبل/بعد).',
    items: [
      'تسجيل كل CREATE / UPDATE / DELETE.',
      'صورة كاملة قبل وبعد + مَن ومتى ومن أي IP.',
      'صفحة إدارية مع فلاتر وبحث وتصدير CSV.',
    ],
    days: 1,
    price: 200,
  },
  {
    id: 'Q',
    title: 'كشف لقطات الشاشة (مؤشر احتمالي)',
    desc: 'رصد احتمالي لمحاولات Screenshot ضمن حدود المتصفح.',
    items: [
      'Visibility API + Clipboard API + DevTools Detection.',
      'كشف محاولة الطباعة وضغطة PrintScreen.',
      'إشعار فوري للمدير بكل حدث مريب.',
      'ملاحظة: قيود تقنية — المتصفحات لا تتيح كشفاً يقينياً.',
    ],
    days: 1,
    price: 150,
  },
  {
    id: 'R',
    title: 'محادثة داخلية ثنائية',
    desc: 'رسائل مباشرة بين الموظفين بزمن حقيقي.',
    items: [
      'محادثات ثنائية مع نص وصور وملفات.',
      'مؤشر "مقروء/غير مقروء" و"يكتب الآن".',
      'Realtime عبر Pusher أو Supabase.',
      'صلاحية قراءة المدير لأي محادثة.',
    ],
    days: 2,
    price: 400,
  },
  {
    id: 'S',
    title: 'محادثات جماعية ومجموعات',
    desc: 'مجموعات للفِرَق والإدارات.',
    items: [
      'مجموعات ديناميكية (فريق مناوبة، إدارة، كل الموظفين).',
      'إدارة أعضاء + إشعارات لكل مجموعة.',
      'سجل محفوظ قابل للبحث.',
    ],
    days: 1,
    price: 200,
  },
]

// Compute totals
const totalDays = modules.reduce((s, m) => s + m.days, 0)
const totalPrice = modules.reduce((s, m) => s + m.price, 0)

// Compute weeks from days (5 days/week)
function daysToWeeks(d) {
  const w = d / 5
  if (w < 1) return `${d} يوم`
  return `${w.toFixed(1).replace('.0', '')} أسبوع`
}

// ── content ──────────────────────────────────────────────────────────────
const children = []

// ─── COVER ────────────────────────────────────────────────────────────────
children.push(Empty(), Empty(), Empty(), Empty())
children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 240 },
  children: [ar('عرض تطوير مرن', { size: 60, bold: true, color: COL_TITLE_NAVY })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 440 },
  children: [en('Modular Development Proposal', { size: 32, color: COL_SUBTITLE_GRAY })],
}))
children.push(new Paragraph({
  bidirectional: true,
  spacing: { before: 0, after: 440 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: COL_TITLE_NAVY, space: 1 } },
  children: [],
}))
children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 200, line: 340, lineRule: 'auto' },
  children: [ar('منصة إدارة العمليات الداخلية', { size: 44, bold: true, color: COL_NAVY_DARK })],
}))
children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 120, line: 340, lineRule: 'auto' },
  children: [ar('ASH Group — المرحلة الثانية', { size: 30, color: COL_NAVY_DARK })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 640 },
  children: [en('Internal Operations Management Platform — Phase 2', { size: 26, color: COL_SUBTITLE_GRAY })],
}))
children.push(Empty(), Empty())
children.push(makeTable([3000, 6026], [
  ['الإصدار', '2.0 (تقسيم معياري)'],
  ['التاريخ', new Date().toISOString().slice(0, 10)],
  ['السعر الإجمالي (في حال اختيار كل الأقسام)', `${totalPrice.toLocaleString('en')} دولار`],
  ['المدة الإجمالية', `${totalDays} يوم عمل ≈ ${daysToWeeks(totalDays)}`],
  ['أقل مدة ممكنة', 'أسبوعان (عند اختيار أقل عدد من الأقسام)'],
  ['طريقة العمل', 'يختار العميل الأقسام التي تناسبه، ويُحسَب السعر والمدة تلقائياً.'],
], { stripe: true }))

children.push(new Paragraph({ bidirectional: true, children: [], pageBreakBefore: true }))

// ─── Overview ─────────────────────────────────────────────────────────────
children.push(H1('مقدمة: لماذا التقسيم المعياري؟'))
children.push(P('هذا العرض يقسّم مشروع المرحلة الثانية إلى أقسام صغيرة مستقلة، كل قسم له:'))
children.push(B('وصف واضح لما يُنجز ضمنه.'))
children.push(B('سعر مستقل قابل للاختيار أو الإلغاء.'))
children.push(B('مدة تطوير محددة.'))
children.push(P('يستطيع العميل اختيار الأقسام التي يحتاجها فوراً، وترك البقية لمرحلة لاحقة.'))
children.push(P('عند اختيار الحد الأدنى (قسمَين أو ثلاثة أساسيين)، يمكن تقليص فترة التطوير إلى أسبوعَين. عند اختيار كل الأقسام، تمتد الفترة إلى ستة أسابيع بسعر إجمالي 5,000 دولار.', { bold: true }))

children.push(H3('ملاحظات مهمة'))
children.push(B('كل الأقسام تُبنى فوق المنصة القائمة ولا تُؤثّر على تشغيلها خلال فترة التطوير.'))
children.push(B('الأقسام مرتبة بالأحرف (أ، ب، ج…) لتسهيل الإشارة إليها عند الاختيار.'))
children.push(B('بعض الأقسام تعتمد على بعضها (مثلاً: الراتب الأسبوعي يحتاج جلسات الحضور). هذه التبعيات موضّحة في كل قسم.'))
children.push(B('الأسعار لا تشمل أي خدمات خارجية مدفوعة (مثل خدمة Realtime بعد تجاوز الحد المجاني).'))

children.push(new Paragraph({ bidirectional: true, children: [], pageBreakBefore: true }))

// ─── Modules ──────────────────────────────────────────────────────────────
children.push(H1('الأقسام التفصيلية'))

for (const m of modules) {
  children.push(H2(`${m.id}. ${m.title}`, { color: COL_TITLE_NAVY }))
  children.push(P(m.desc, { bold: true }))
  // Module meta — inline text, not a table
  children.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 60, after: 160, line: 320, lineRule: 'auto' },
    children: [
      ar('المدة: ', { size: 24, bold: true, color: COL_NAVY_DARK }),
      ar(`${m.days} يوم / ${daysToWeeks(m.days)}`, { size: 24, color: COL_BODY }),
      ar('    ·    ', { size: 24, color: COL_SUBTITLE_GRAY }),
      ar('السعر: ', { size: 24, bold: true, color: COL_NAVY_DARK }),
      ar(`${m.price.toLocaleString('en')} دولار`, { size: 24, bold: true, color: COL_ACCENT }),
    ],
  }))
  children.push(H3('ما يشمله هذا القسم'))
  for (const item of m.items) children.push(B(item))
}

children.push(new Paragraph({ bidirectional: true, children: [], pageBreakBefore: true }))

// ─── Summary table ────────────────────────────────────────────────────────
children.push(H1('الجدول الموجز'))
children.push(P('ملخص الأقسام بالترتيب مع المدة والسعر لكل منها.'))

const summaryRows = [['الرمز', 'القسم', 'المدة', 'السعر']]
for (const m of modules) {
  summaryRows.push([
    m.id,
    m.title,
    `${m.days} يوم`,
    `${m.price.toLocaleString('en')} $`,
  ])
}
summaryRows.push([
  '—',
  'الإجمالي (كل الأقسام)',
  `${totalDays} يوم`,
  `${totalPrice.toLocaleString('en')} $`,
])
children.push(makeTable([900, 5200, 1500, 1426], summaryRows, {
  centerCols: [0, 2, 3],
  stripe: true,
}))

children.push(H3('ملاحظات عامة'))
children.push(B('تبقى المنصة الحالية متاحة طوال فترة التطوير دون انقطاع.'))
children.push(B('بعض الأقسام تعتمد على بعضها — مثلاً: الرواتب الأسبوعي يعتمد على تسجيل الحضور.'))
children.push(B('الأسعار لا تشمل رسوم أي خدمات خارجية مدفوعة (مثل Realtime بعد الحد المجاني).'))

// ── Document ───────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'ASH Group',
  title: 'عرض تطوير معياري — المرحلة الثانية',
  styles: {
    default: {
      document: { run: { font: { name: FONT_LATIN, cs: FONT_ARABIC }, size: 24 } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: { name: FONT_LATIN, cs: FONT_ARABIC }, color: COL_TITLE_NAVY },
        paragraph: { bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 480, after: 220, line: 320, lineRule: 'auto' }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: { name: FONT_LATIN, cs: FONT_ARABIC }, color: COL_NAVY_DARK },
        paragraph: { bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 360, after: 180, line: 320, lineRule: 'auto' }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: { name: FONT_LATIN, cs: FONT_ARABIC }, color: '000000' },
        paragraph: { bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 280, after: 140, line: 320, lineRule: 'auto' }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.RIGHT,
          style: { paragraph: { indent: { right: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
      rtlGutter: true,
    },
    children,
  }],
})

const outputPath = path.resolve(__dirname, '..', 'SRS-Phase-2-Modular.docx')
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf)
  console.log('✅ Created:', outputPath, `(${(buf.length / 1024).toFixed(1)} KB)`)
  console.log('Total modules:', modules.length)
  console.log('Total days:', totalDays, '(' + daysToWeeks(totalDays) + ')')
  console.log('Total price: $' + totalPrice)
})
