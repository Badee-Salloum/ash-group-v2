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
docker compose up -d postgres
docker compose --profile release run --rm migrate
docker compose --profile seed run --rm seed
docker compose up -d app

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
npm run db:migrate
# Optional local sample data only
# npm run db:seed

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

---

## Production performance rollout

The performance migration is deliberately an **expand / backfill / switch**
release. It must be run as a release job, never during `next build` or while
the web container is starting.

1. Rotate any database or deployment credentials that were ever shared outside
   the deployment secret store.
2. Set `DATABASE_URL` to the pooled Neon runtime URL and set
   `DIRECT_DATABASE_URL` to the direct Neon URL. The direct URL is only for
   migration, index, and backfill jobs.
3. Deploy the additive migration with `npm run db:migrate:deploy`.
4. Run `npm run db:performance-indexes` once. It uses
   `CREATE INDEX CONCURRENTLY`, so it must not run inside a Prisma migration
   transaction.
5. Run `npm run db:backfill-performance` using the direct URL. It checkpoints
   derived-field work in batches of 2,000 rows and only marks the read models
   ready after the summaries are complete.
6. Verify dashboard totals against the reference query, then deploy the web
   application. The application falls back to exact base-table aggregates
   until the read-model readiness marker exists.

`vercel.json` pins server functions to `fra1`, near a Neon deployment in AWS
`eu-central-1`. Keep `DATABASE_CONNECTION_LIMIT` low (the default is 3) for
serverless deployments, and do not place `DIRECT_DATABASE_URL` in the runtime
function environment.

### Currency anomalies in the existing duplicate banner

The same reconciliation banner and **عرض** button now include distinct linked
currency anomalies as well as true number reuse. Both sides remain visible and
use the same red duplicate badge, with the original transaction status.
`hasDuplicateSc` and `hasCurrencyMismatch` distinguish the reasons internally
without changing links, amounts, statuses or employee classifications.

For this release, apply `20261007090000_duplicate_currency_review`, then run
`npm run db:backfill-currency-review` against Neon before deploying the web app.
The enrichment is idempotent and only upserts the small review read model; it
does not rebuild or truncate the financial summaries. Known transaction writes
refresh the affected review groups, including removing resolved anomalies.
Ordinary page requests join the read model instead of scanning all linked rows.

### Preventing and repairing cross-currency matches

All historical, complaint and manual resolution paths now require an explicit
matching currency (case/whitespace normalized); an unknown currency is never
assumed to be USD. Historical candidates are keyed by number **and** currency,
and ambiguous candidates stay pending. The deposit and withdrawal manual
resolution actions also validate account access, source/type, existing links
and amounts before writing.

Release order: create `transactions_matchedTxId_idx` concurrently using the
performance-index script, apply `20261008090000_enforce_link_currency`, deploy
the application, then run `npm run db:repair-currency-matches` (dry run) and
`npm run db:repair-currency-matches -- --apply`. The deferred database constraint
also guards raw SQL, both incoming and outgoing links, and later currency edits.
Its checks lock counterparts against concurrent currency changes; normal
unlinked inserts / status-only updates do not scan or lock counterpart rows.

Repair uses short serializable transactions of at most five pairs per account.
It preserves amounts, currencies, raw data and previous review classifications,
adds a re-review note, clears links/differences, and returns each source to its
pending bucket. Audit snapshots and affected financial/customer/duplicate
summaries are committed with each batch. Any concurrent edit rolls back that
batch; rerun to resume. No automatic exchange-rate conversion or employee blame
is inferred. Nonreciprocal/cross-account corruption fails closed for separate
review instead of guessing a repair.

Incremental financial refreshes now explicitly interpret stored timestamps as
UTC before converting to Damascus business dates. Both legacy and corrected
date keys for changed transactions are rebuilt, including midnight boundaries.
The full backfill uses the same corrected date expression. Historical days not
touched by incremental writes still require the separate full summary backfill
to migrate their legacy date keys; this repair does not truncate/rebuild all
financial history.
