# منصة إدارة الحركة المالية
## Financial Transaction Management & Reconciliation Platform

---

## 🚀 تشغيل سريع مع Docker

```bash
# 1. نسخ متغيرات البيئة
cp .env.example .env

# 2. تعديل JWT_SECRET في ملف .env
#    openssl rand -base64 32

# 3. تشغيل المنصة
docker compose up -d

# 4. افتح المتصفح
open http://localhost:3000
```

**بيانات الدخول الافتراضية:**
- البريد: `admin@platform.local`
- كلمة المرور: `Admin@123456`

> ⚠️ غيّر كلمة المرور فور تسجيل الدخول الأول

---

## 🛠 تشغيل في بيئة التطوير

```bash
# 1. تثبيت الاعتماديات
npm install

# 2. تشغيل PostgreSQL
docker compose up postgres -d

# 3. إعداد متغيرات البيئة
cp .env.example .env
# عدّل DATABASE_URL و JWT_SECRET

# 4. إعداد قاعدة البيانات
npm run db:generate
npm run db:push
npm run db:seed

# 5. تشغيل الخادم
npm run dev
```

---

## 📁 هيكل المشروع

```
src/
├── app/
│   ├── (auth)/login/          # صفحة تسجيل الدخول
│   ├── (dashboard)/           # صفحات لوحة التحكم
│   │   ├── dashboard/         # الرئيسية
│   │   ├── reconciliation/    # المطابقة
│   │   ├── upload/            # رفع الملفات
│   │   ├── profits/           # الأرباح
│   │   ├── expenses/          # الصرفيات
│   │   ├── accounts/          # الحسابات
│   │   └── users/             # المستخدمون
│   └── api/                   # API Routes
│       ├── auth/              # login / logout
│       ├── upload/            # رفع ومعالجة الملفات
│       ├── transactions/      # العمليات + إحصائيات
│       ├── profits/           # حساب الأرباح
│       ├── expenses/          # الصرفيات CRUD
│       ├── accounts/          # الحسابات CRUD
│       └── users/             # المستخدمون CRUD
├── lib/
│   ├── auth/                  # JWT، تشفير، جلسات
│   ├── db/                    # Prisma client
│   ├── parsers/               # قراءة ملفات شام كاش والمنصة
│   └── reconciliation/        # محرك المطابقة + batch processor
├── components/
│   ├── layout/                # Sidebar, Topbar
│   └── tables/                # DataTable القابل للفلترة
└── types/                     # TypeScript types
```

---

## 📊 منطق المطابقة

### الإيداعات
- الربط عبر رقم عملية شام كاش المُستخرَج من حقل `User info`
- الحالات: مطابقة / شام كاش فقط / المنصة فقط / فارق SC أكبر / فارق P أكبر

### السحوبات
- الربط عبر التقارب الزمني (≤ 30 ثانية بين `Time of payout` و وقت شام كاش) + تطابق المبلغ
- الحالات: مطابقة / شام كاش فقط / المنصة فقط / فارق SC أكبر / فارق P أكبر

### الدورة اليومية
- كل رفعة تُعيد فحص العمليات المعلقة السابقة
- عمليات PENDING_SC تنتظر إيداع المنصة المقابل (الشكوى من طرف ثالث)

---

## 🔐 الأدوار والصلاحيات

| الدور | الوصف |
|-------|-------|
| ADMIN | وصول كامل لكل شيء |
| ACCOUNTANT | رفع ملفات، مطابقة، صرفيات |
| SUPERVISOR | عرض فقط لجميع الحسابات |
| ACCOUNT_MGR | عرض للحسابات المحددة له فقط |

---

## 🏗 التقنيات

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT (jose) + bcrypt + 2FA جاهز
- **File Processing**: ExcelJS + XML parser
- **Deployment**: Docker Compose
