// Build SRS Phase 2 as .docx — Arabic-optimized, no cost/timeline.
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, LevelFormat, BorderStyle, WidthType, ShadingType,
} = require('docx')

// ── Design tokens (matching reference doc) ───────────────────────────────
// Arabic-friendly fonts. Arial is the Latin fallback; Complex-Script font
// renders Arabic. Traditional Arabic / Simplified Arabic / Arial are widely
// available on Windows and Mac. We use "Arial" as cs because the client's
// reference file uses it and it ships everywhere.
const FONT_LATIN = 'Arial'
const FONT_ARABIC = 'Arial'

const COL_TITLE_NAVY = '1f4e79'
const COL_SUBTITLE_GRAY = '7f8c8d'
const COL_NAVY_DARK = '2c3e50'
const COL_BODY = '333333'
const COL_H4_BLUE = '2e74b5'
const COL_BORDER = 'bdc3c7'
const COL_SHADE = 'f2f2f2'

// ── helpers ───────────────────────────────────────────────────────────────

// Arabic run — rightToLeft, cs font, good spacing
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

// Latin run
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

// Arabic paragraph (body)
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

function H2(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 180, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 30, bold: true, color: COL_NAVY_DARK })],
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

function H4(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 200, after: 100, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 24, italics: true, color: COL_H4_BLUE, bold: true })],
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

function N(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    numbering: { reference: 'nums', level: 0 },
    spacing: { after: 90, line: 320, lineRule: 'auto' },
    children: [ar(text, { size: 24 })],
  })
}

function Empty() {
  return new Paragraph({ bidirectional: true, spacing: { before: 0, after: 0 }, children: [] })
}

// Tables
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
    children: [new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 0, line: 300, lineRule: 'auto' },
      children: [ar(String(text), {
        size: 22,
        color: opts.bold ? COL_TITLE_NAVY : COL_BODY,
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
          bold: i === 0,
        })),
      })
    ),
  })
}

// ── content ──────────────────────────────────────────────────────────────
const children = []

// ─── COVER ────────────────────────────────────────────────────────────────
children.push(Empty(), Empty(), Empty(), Empty())

children.push(new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 240, line: 320, lineRule: 'auto' },
  children: [ar('مواصفات متطلبات البرمجيات', { size: 60, bold: true, color: COL_TITLE_NAVY })],
}))

children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 440 },
  children: [en('Software Requirements Specification', { size: 32, color: COL_SUBTITLE_GRAY })],
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
  children: [ar('ASH Group — امتداد للنسخة الأولى', { size: 30, color: COL_NAVY_DARK })],
}))

children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 640 },
  children: [en('Internal Operations Management Platform — Phase 2', { size: 26, color: COL_SUBTITLE_GRAY })],
}))

children.push(Empty(), Empty())

// Meta table (no cost/duration)
children.push(makeTable([3000, 6026], [
  ['الإصدار', '2.0'],
  ['التاريخ', new Date().toISOString().slice(0, 10)],
  ['المرحلة', 'المرحلة الثانية — امتداد للمنصة القائمة'],
  ['الحالة', 'مسودة للمراجعة'],
], { stripe: true }))

children.push(new Paragraph({ bidirectional: true, children: [], pageBreakBefore: true }))

// ─── 1. Context ────────────────────────────────────────────────────────────
children.push(H1('1. السياق والغرض'))
children.push(P('تُدير المنصة الحالية (النسخة 1.0) المطابقة المالية بين نظام شام كاش وملفات المنصة الخارجية.'))
children.push(P('تبني النسخة 2.0 فوق المنصة القائمة، وتضيف طبقة متكاملة لإدارة العمليات الداخلية، تشمل:'))
children.push(B('إدارة الموظفين وحضورهم.'))
children.push(B('جدولة المناوبات وتوزيعها آلياً.'))
children.push(B('الرواتب والمكافآت بصيغتها الأسبوعية.'))
children.push(B('قنوات تواصل داخلية آمنة.'))
children.push(B('طبقة تدقيق أمني متقدمة.'))
children.push(P('لا يتضمّن هذا التوسيع أي استبدال لميزة موجودة. كل التعديلات تراكمية فقط.', { bold: true }))

// ─── 2. Functional Requirements ───────────────────────────────────────────
children.push(H1('2. المتطلبات الوظيفية'))

// 2.1
children.push(H2('2.1 نظام إدارة الموظفين'))
children.push(H3('2.1.1 ملف الموظف'))
children.push(B('يُوسَّع جدول User الحالي ليشمل: رمز الموظف، المسمى الوظيفي، تاريخ التعيين، الراتب الأساسي، معرّف المدير المباشر.'))
children.push(B('تُضاف الصورة الشخصية، رقم الهاتف، العنوان.'))
children.push(B('تُبنى هرمية تنظيمية شجرية؛ لكل موظف مدير مباشر واحد، ويمكن لأي موظف أن يكون له عدة مرؤوسين.'))
children.push(B('تُعرض الهرمية بصرياً في صفحة "الهيكل التنظيمي".'))

children.push(H3('2.1.2 تسجيل الدخول والخروج'))
children.push(P('نظام المناوبات ثلاثي (ثمان ساعات لكل مناوبة):'))
children.push(B('المناوبة الأولى: من السادسة صباحاً حتى الثانية ظهراً.'))
children.push(B('المناوبة الثانية: من الثانية ظهراً حتى العاشرة مساءً.'))
children.push(B('المناوبة الثالثة: من العاشرة مساءً حتى السادسة صباحاً.'))
children.push(H4('آلية تبديل المناوبات'))
children.push(N('يضغط الموظف الخارج "طلب إنهاء مناوبة" فيُسجَّل طلبه.'))
children.push(N('يضغط الموظف الداخل "طلب بدء مناوبة" فيُسجَّل طلبه.'))
children.push(N('يُوافق المشرف على الطلبَين معاً، فتُغلق جلسة الخارج وتُفتح جلسة الداخل.'))
children.push(P('يُسجَّل لكل جلسة: معرّف الموظف، وقت البدء، وقت الانتهاء، معرّف موظف التسليم السابق، المشرف المعتمد، والمحافظ المختارة.'))
children.push(P('إن حاول موظف بدء مناوبة قبل تأكيد تسليم سابقه، يُرفض الطلب مع رسالة واضحة.'))

children.push(H3('2.1.3 اختيار المحافظ في كل جلسة'))
children.push(B('يضبط مدير النظام قائمة المحافظ المسموحة لكل موظف.'))
children.push(B('عند تسجيل الدخول، يختار الموظف المحافظ التي سيعمل عليها في تلك الجلسة.'))
children.push(B('تُربط كل عملية لاحقاً بالجلسة والمحفظة المختارة للتتبع الدقيق.'))

// 2.2
children.push(H2('2.2 جدولة المناوبات'))
children.push(H3('2.2.1 الاقتراح الآلي'))
children.push(B('يحدد المدير الحد الأدنى من الموظفين المطلوب لكل مناوبة.'))
children.push(B('توزّع الخوارزمية الموظفين آلياً على ثلاث مناوبات × سبعة أيام.'))
children.push(B('تقترح الخوارزمية أيام العطل مع مراعاة: الحد الأدنى لكل مناوبة، طلبات الإجازات المعتمدة، والتوزيع العادل.'))
children.push(B('يمكن للمدير اعتماد الاقتراح أو تعديله يدوياً بأسلوب السحب والإفلات.'))

children.push(H3('2.2.2 طريقة العرض'))
children.push(B('تقويم أسبوعي بصري يعرض الموظفين بألوان مميزة.'))
children.push(B('تعديل يدوي مباشر عبر السحب والإفلات.'))
children.push(B('تصدير الجدول كملف PDF للطباعة والتوزيع.'))

// 2.3
children.push(H2('2.3 الإجازات'))
children.push(B('يتقدم الموظف بطلب الإجازة من المنصة (من تاريخ، إلى تاريخ، النوع، السبب).'))
children.push(B('أنواع الإجازة: سنوية، مرضية، طارئة، بدون راتب.'))
children.push(B('يوافق المدير المباشر أو يرفض؛ وتنعكس الموافقة تلقائياً على جدول المناوبات.'))
children.push(B('يُحتفظ برصيد إجازات سنوي لكل موظف، قابل للضبط من مدير النظام.'))

// 2.4
children.push(H2('2.4 الرواتب والمكافآت'))
children.push(H3('2.4.1 الراتب الأسبوعي'))
children.push(B('يُحتسَب الراتب كل يوم جمعة (قابل للتخصيص).'))
children.push(B('المعادلة: الراتب الأساسي × (الساعات الفعلية ÷ المتوقعة) + المكافآت − السلف − الخصومات.'))
children.push(B('يُحفَظ كل سجل راتب مستقلاً في PayrollEntry.'))

children.push(H3('2.4.2 طلب السلفة'))
children.push(B('يتقدم الموظف بطلب السلفة عبر المنصة مع بيان المبلغ والسبب.'))
children.push(B('بعد موافقة المدير تُخصَم السلفة من راتب الأسبوع التالي.'))
children.push(B('الحد الأقصى: خمسون بالمئة من الراتب الأساسي (قابل للتخصيص).'))

children.push(H3('2.4.3 المكافآت التراكمية'))
children.push(B('كل أسبوع يُنجزه الموظف بدون أخطاء تتضاعف مكافأته بقيمة ثابتة (مثلاً خمسة دولارات).'))
children.push(B('أي خطأ (سرقة أو خطأ موظف) يُصفِّر المكافأة التراكمية فوراً.'))
children.push(B('يستطيع مدير النظام تعديل المكافأة يدوياً (زيادةً أو تخفيضاً) مع تسجيل ملاحظة مبرّرة.'))

children.push(H3('2.4.4 المكافآت الجماعية'))
children.push(B('واجهة خاصة لاختيار مجموعة موظفين أو كامل الفريق.'))
children.push(B('تحديد مبلغ لكل موظف مع توضيح السبب.'))
children.push(B('تُضاف المكافأة لجميع المختارين بضغطة زر واحدة لراتب الأسبوع الحالي.'))

children.push(H3('2.4.5 ربط العمليات المالية بالموظفين'))
children.push(P('تُربط تلقائياً جلسات عمل الموظف بالعمليات المالية المرتبطة في النسخة 1، عبر معيارَين:'))
children.push(B('التطابق الزمني: يقع وقت العملية داخل فترة الجلسة (بدء ← انتهاء).'))
children.push(B('المحفظة: تقع العملية ضمن المحافظ التي اختارها الموظف لتلك الجلسة.'))
children.push(H4('الحقول الجديدة على جدول Transaction'))
children.push(B('handledByUserId: معرف الموظف المسؤول.'))
children.push(B('handledInSessionId: معرف الجلسة.'))
children.push(B('handlerAmbiguous: علامة للحالات الملتبسة (تبديل مناوبة في نفس اللحظة).'))
children.push(H4('الاستخدامات العملية'))
children.push(B('في لوحة الموظف: عدد العمليات المنجزة خلال الفترة.'))
children.push(B('احتساب الأخطاء: أي عملية مصنّفة "خطأ موظف" ومرتبطة بجلسته تُنسب له.'))
children.push(B('أثر المكافأة التراكمية: أسبوع خالٍ من الأخطاء يراكم المكافأة، وأي خطأ يُصفّرها.'))
children.push(B('تقارير الأداء الأسبوعية والشهرية: نسبة المطابقة، متوسط الفارق، عدد العمليات.'))
children.push(B('تقارير المحفظة: قائمة الموظفين الذين عملوا عليها ومواعيد عملهم.'))
children.push(P('معيار القبول: تُنسَب تلقائياً خمسٌ وتسعون بالمئة من العمليات لموظف محدد.', { bold: true }))

// 2.5
children.push(H2('2.5 لوحة الموظف'))
children.push(P('صفحة شخصية يراها كل موظف عند دخوله، تعرض:'))
children.push(B('راتب الأسبوع الحالي (تقديراً) مع آخر أربعة رواتب مدفوعة.'))
children.push(B('رصيد الإجازات المتبقية.'))
children.push(B('عدد العمليات المنجزة هذا الأسبوع وهذا الشهر.'))
children.push(B('عدد الأخطاء المنسوبة إليه.'))
children.push(B('قيمة المكافأة التراكمية الحالية.'))
children.push(B('آخر عشرة إشعارات.'))
children.push(B('زر تسجيل الدخول والخروج بارز.'))

// 2.6
children.push(H2('2.6 الإشعارات الذكية'))
children.push(B('جرس الإشعارات في الشريط العلوي مع شارة لعدد غير المقروء.'))
children.push(H4('أنواع الإشعارات'))
children.push(B('طلبات تحتاج موافقة المدير.'))
children.push(B('جاهزية الراتب الأسبوعي.'))
children.push(B('إضافة مكافأة جديدة.'))
children.push(B('نسبة خطأ جديد للموظف.'))
children.push(B('تنبيهات بدء وانتهاء المناوبة.'))
children.push(B('رسائل المحادثة الداخلية.'))
children.push(B('تنبيهات أمنية (محاولات دخول، لقطات شاشة).'))
children.push(B('إرسال إشعارات فورية عبر المتصفح (Web Push).'))
children.push(B('يختار كل مستخدم أنواع الإشعارات التي يستقبلها.'))

// 2.7
children.push(H2('2.7 البحث الشامل'))
children.push(B('شريط بحث ثابت أعلى كل الصفحات، يُستدعى بالاختصار Ctrl+K.'))
children.push(H4('مجالات البحث'))
children.push(B('الموظفون (الاسم، الرمز، المسمى الوظيفي).'))
children.push(B('العمليات المالية (الأرقام، اسم العميل، المبلغ).'))
children.push(B('المحافظ والحسابات.'))
children.push(B('رسائل المحادثة.'))
children.push(B('السجلات والتقارير.'))
children.push(B('تُعرض النتائج مجمَّعة بأقسام، مع روابط مباشرة للتفاصيل.'))

// 2.8
children.push(H2('2.8 حظر عناوين IP'))
children.push(B('جدول BlockedIP يحفظ: العنوان، مَن حظره، السبب، التاريخ، تاريخ انتهاء الحظر.'))
children.push(B('Middleware يفحص كل طلب؛ العناوين المحظورة تُرفَض بكود 403.'))
children.push(B('واجهة إدارية للمدير فقط: قائمة العناوين المحظورة، الإضافة، الإزالة، التحديث.'))
children.push(B('قائمة عناوين مسموحة (Whitelist) اختيارية لكل مستخدم.'))
children.push(B('حظر آلي بعد خمس محاولات دخول فاشلة متتالية من نفس العنوان.'))

// 2.9
children.push(H2('2.9 تاريخ التعديلات الكامل'))
children.push(B('توسيع سجل التدقيق (AuditLog) ليشمل عمليات الإنشاء والتعديل والحذف على كل جدول رئيسي.'))
children.push(B('حفظ صورة "قبل/بعد" كاملة بصيغة JSON.'))
children.push(B('تسجيل مَن قام بالتعديل ومتى ومن أي عنوان IP ومتصفح (User-Agent).'))
children.push(H4('صفحة سجل التدقيق للمدير'))
children.push(B('فلاتر متعددة: الجدول، المستخدم، نوع الإجراء، نطاق التاريخ.'))
children.push(B('بحث حر في محتوى السجل.'))
children.push(B('تصدير إلى CSV.'))
children.push(B('سياسة الاحتفاظ: اثنا عشر شهراً ثم أرشفة.'))

// 2.10
children.push(H2('2.10 كشف لقطات الشاشة'))
children.push(P('المتصفحات لا تتيح الكشف اليقيني عن لقطات الشاشة؛ فما يُنفَّذ هو "مؤشرات احتمالية" موثّقة كما يلي:', { bold: true, color: 'C00000' }))
children.push(B('Visibility API لرصد إخفاء التبويب أو فقدان التركيز.'))
children.push(B('Clipboard API لرصد عمليات النسخ من الصفحة.'))
children.push(B('كشف محاولات الطباعة (Print Detection).'))
children.push(B('كشف فتح أدوات المطور (DevTools Detection).'))
children.push(B('رصد ضغطة مفتاح Print Screen داخل الصفحة.'))
children.push(B('تُسجَّل كل الأحداث المشبوهة في جدول SecurityEvent مع إشعار فوري للمدير.'))
children.push(P('يُنبَّه العميل صراحةً إلى أن هذا "مؤشر احتمالي" لا دليل قاطع.', { italics: true }))

// 2.11
children.push(H2('2.11 نظام المحادثة والمجموعات'))
children.push(B('محادثات ثنائية بين الموظفين.'))
children.push(B('مجموعات (فريق المناوبة، الإدارة، جميع الموظفين).'))
children.push(B('دعم النص والصور والملفات واقتباس الرسائل.'))
children.push(B('مؤشرات: "مقروء/غير مقروء" و"يكتب الآن".'))
children.push(B('إشعارات فورية للرسائل الجديدة.'))
children.push(B('سجل المحادثة محفوظ وقابل للبحث.'))
children.push(B('تواصل فوري (Realtime) عبر WebSocket (Pusher أو Supabase أو Ably).'))
children.push(B('صلاحية المدير: الاطلاع على أي محادثة ضمن الشركة لضمان الشفافية.'))

// ─── 3. NFR ────────────────────────────────────────────────────────────────
children.push(H1('3. المتطلبات غير الوظيفية'))
children.push(makeTable([3000, 6026], [
  ['الجانب', 'المتطلب'],
  ['الأداء', 'تحميل الصفحات خلال ثانيتين، استجابة تسجيل الدخول خلال 500 مللي ثانية.'],
  ['التوافق', 'متصفحات Chrome و Edge و Safari (آخر نسختَين)، وأنظمة iOS و Android.'],
  ['الأمان', 'تشفير كلمات المرور (bcrypt)، JWT مع HttpOnly، خاصية 2FA اختيارية.'],
  ['التوفر', '99.5 بالمئة فأكثر (استضافة Vercel).'],
  ['اللغة', 'العربية كاملة مع إنجليزية اختيارية.'],
  ['القاعدة', 'PostgreSQL على Neon، كامتداد للقاعدة الحالية.'],
]))

// ─── 4. Tech ──────────────────────────────────────────────────────────────
children.push(H1('4. النموذج التقني'))
children.push(P('يستمر العمل على نفس المنظومة التقنية الحالية:', { bold: true }))
children.push(B('Next.js 14 (App Router).'))
children.push(B('Prisma مع PostgreSQL (Neon).'))
children.push(B('TailwindCSS.'))
children.push(B('النشر على Vercel.'))
children.push(H4('إضافات المرحلة الجديدة'))
children.push(B('Pusher أو Supabase Realtime لقنوات المحادثة والإشعارات الفورية.'))
children.push(B('Web Push API مع Service Worker للإشعارات خارج المتصفح.'))
children.push(B('Vercel Cron لاحتساب الرواتب الأسبوعية.'))
children.push(B('مكتبة Sharp لمعالجة صور الموظفين.'))

// ─── 5. Schema ────────────────────────────────────────────────────────────
children.push(H1('5. الجداول الجديدة'))
children.push(makeTable([2800, 6226], [
  ['الجدول', 'الحقول الأساسية'],
  ['User (توسعة)', '+ employeeCode, jobTitle, hireDate, baseSalary, managerId, phone, avatar'],
  ['ShiftSession', 'userId, startAt, endAt, handoverFromUserId, approvedBy, status'],
  ['ShiftSessionWallet', 'sessionId, walletId'],
  ['EmployeeWalletAssignment', 'userId, walletId'],
  ['Shift', 'date, shiftNumber, userId, assignedBy, status'],
  ['LeaveRequest', 'userId, fromDate, toDate, type, reason, status, approvedBy'],
  ['LeaveBalance', 'userId, year, total, used, remaining'],
  ['PayrollEntry', 'userId, weekStart, weekEnd, baseSalary, workedHours, bonus, advance, net'],
  ['AdvanceRequest', 'userId, amount, reason, status, approvedBy, payrollEntryId'],
  ['BonusLog', 'userId, amount, type, reason, createdBy, weekStart'],
  ['Notification', 'userId, type, title, body, link, readAt'],
  ['NotificationPreference', 'userId, type, enabled'],
  ['BlockedIP', 'ipAddress, blockedBy, reason, blockedAt, expiresAt, attempts'],
  ['SecurityEvent', 'userId, type, metadata, ipAddress, userAgent'],
  ['Conversation', 'type, title, createdBy'],
  ['ConversationMember', 'conversationId, userId, joinedAt, lastReadAt, role'],
  ['Message', 'conversationId, senderId, content, attachments, replyToId'],
  ['Transaction (توسعة)', '+ handledByUserId, handledInSessionId, handlerAmbiguous'],
], { stripe: true }))

// ─── 6. Roles ─────────────────────────────────────────────────────────────
children.push(H1('6. الأدوار والصلاحيات'))
children.push(makeTable([2500, 6526], [
  ['الدور', 'الوصف'],
  ['ADMIN', 'مدير النظام — يملك كامل الصلاحيات.'],
  ['MANAGER (جديد)', 'مدير فرع أو فريق — يعتمد إجازات وسلف ومناوبات مرؤوسيه، ويرى محادثاتهم.'],
  ['ACCOUNTANT', 'محاسب — موجود حالياً، تُضاف له صلاحية تعديل الرواتب والمكافآت.'],
  ['EMPLOYEE (جديد)', 'موظف عادي — تسجيل دخول وخروج، استعراض لوحته، تقديم طلبات، استخدام المحادثة.'],
  ['SUPERVISOR / ACCOUNT_MGR', 'كما هما في النسخة 1 دون تغيير.'],
]))

// ─── 7. Zero-downtime ─────────────────────────────────────────────────────
children.push(H1('7. استمرارية العمل أثناء التطوير'))
children.push(P('تبقى المنصة الحالية (النسخة 1.0) متاحة للمستخدمين طوال فترة تطوير النسخة 2 بدون أي انقطاع.', { bold: true }))
children.push(H3('البنية المقترحة'))
children.push(N('بيئتان مستقلتان على Vercel: الإنتاج الحالي ash-group.vercel.app يستمر بخدمة المستخدمين، وبيئة المعاينة ash-group-v2.vercel.app للتطوير والاختبار المشترك مع العميل.'))
children.push(N('قاعدة بيانات واحدة مشتركة، وكل التغييرات تراكمية فقط، دون أي حذف أو تعديل مُكسر لأي عمود قائم.'))
children.push(N('تفعيل الميزات بمفاتيح بيئية (Feature Flags) منفصلة: ENABLE_EMPLOYEE_MGMT و ENABLE_CHAT و ENABLE_PAYROLL وغيرها.'))
children.push(N('إطلاق تدريجي لكل ميزة: تطوير، ثم معاينة، ثم اعتماد من العميل، ثم تفعيل على الإنتاج، ثم إعلان.'))
children.push(N('نوافذ صيانة اختيارية خارج ساعات العمل عند الحاجة، مع إشعار مسبق أربعاً وعشرين ساعة.'))
children.push(H3('الضمانات للعميل'))
children.push(B('لا فقدان للبيانات؛ جميع التعديلات تراكمية.'))
children.push(B('لا انقطاع مفاجئ؛ أي نشر حرج يُجدوَل بالتنسيق المسبق.'))
children.push(B('قابلية التراجع الفورية عن أي ميزة عبر إيقاف Feature Flag.'))
children.push(B('توفير بيئة اختبار موازية ليعاين العميل الميزات قبل إطلاقها.'))

// ─── 8. Deliverables ──────────────────────────────────────────────────────
children.push(H1('8. التسليمات'))
children.push(N('جميع الميزات منشورة على Vercel وقابلة للاستخدام الفعلي.'))
children.push(N('دليل استخدام بالعربية بصيغة PDF.'))
children.push(N('جلسة تدريب افتراضية لمدة ساعة للمدير والفريق.'))
children.push(N('ثلاثون يوماً من الدعم وتصحيح الأخطاء بعد التسليم.'))

// ─── 9. Acceptance ────────────────────────────────────────────────────────
children.push(H1('9. معايير القبول'))
children.push(B('تسجيل موظف جديد يظهر على شجرة الهيكل التنظيمي بشكل صحيح.'))
children.push(B('تنفيذ تسجيل دخول وخروج ناجح مع تبديل مناوبة بين موظفَين.'))
children.push(B('احتساب راتب أسبوعي تلقائياً يوم الجمعة، وانعكاس السلفة خصماً.'))
children.push(B('طلب إجازة يُعتمد ويظهر تلقائياً في جدول المناوبات.'))
children.push(B('اقتراح جدول أسبوعي من النظام يعتمده المدير.'))
children.push(B('رسالة في المحادثة تصل خلال ثانيتَين مع إشعار فوري.'))
children.push(B('محاولة دخول من عنوان IP محظور تُرفَض بنجاح.'))
children.push(B('لقطة شاشة أو طباعة داخل الموقع تُنبِّه المدير فوراً.'))

// ─── 10. Risks ────────────────────────────────────────────────────────────
children.push(H1('10. المخاطر والتحفظات'))
children.push(makeTable([4500, 4526], [
  ['المخاطرة', 'الحد من الأثر'],
  ['كشف لقطات الشاشة غير موثوق تقنياً.', 'توضيح الحدود للعميل وإظهارها كمؤشر احتمالي.'],
  ['حجم رسائل المحادثة قد يضخّم القاعدة.', 'أرشفة دورية بعد ستة أشهر.'],
  ['خوارزمية اقتراح المناوبات قد تكون معقدة.', 'بدء بنموذج بسيط قابل للتعديل اليدوي، وتطوير تدريجي.'],
  ['خدمة Realtime تتطلب اشتراكاً مدفوعاً.', 'الطبقة المجانية من Pusher كافية لحدود مئة اتصال متزامن.'],
]))

// ─── 11. Out of scope ────────────────────────────────────────────────────
children.push(H1('11. خارج النطاق'))
children.push(B('تطبيق موبايل أصلي (Native)؛ تبقى المنصة بصيغة PWA فقط.'))
children.push(B('التكامل مع أنظمة محاسبية خارجية (QuickBooks أو SAP).'))
children.push(B('التحويل المالي الفعلي للرواتب (يقتصر العمل على الحساب والتسجيل).'))
children.push(B('دعم عدة شركات (Multi-tenancy) — قابل للإضافة في مرحلة لاحقة.'))
children.push(B('كشف لقطات الشاشة بهاتف الموظف خارج المتصفح، وهو متعذّر تقنياً دون تطبيق أصلي.'))

// ── Document ───────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'ASH Group',
  title: 'SRS — المرحلة الثانية',
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
      { reference: 'nums', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.RIGHT,
          style: { paragraph: { indent: { right: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
      // RTL for section
      rtlGutter: true,
    },
    children,
  }],
})

const outputPath = path.resolve(__dirname, '..', 'SRS-Phase-2.docx')
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf)
  console.log('✅ Created:', outputPath, `(${(buf.length / 1024).toFixed(1)} KB)`)
})
