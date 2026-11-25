/**
 * Dry run by default; --apply unlinks only reciprocal cross-currency pairs.
 * Financial values and previous review decisions are preserved. Every pair
 * has an audit snapshot. Small serializable batches are independently atomic
 * and resumable; rerunning a successful repair is a no-op.
 * Install the currency constraint trigger before applying this repair.
 */
const fs = require('fs')
const vm = require('vm')
const ts = require('typescript')
const crypto = require('crypto')
const path = require('path')
const { neon } = require('@neondatabase/serverless')
const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw Error('Set DIRECT_DATABASE_URL or DATABASE_URL')
const sql = neon(databaseUrl)
const apply = process.argv.includes('--apply')
const root = path.resolve(__dirname, '..')

// Reuse the application's SQL verbatim. Capture its statements without a
// Prisma TCP connection; execute them in the same Neon transaction as repair.
function loadTs(relativePath, imports = {}) {
  const filename = path.join(root, relativePath)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, Date, Intl,
    console: { warn() { throw Error('Incomplete read-model preparation') } },
    require(name) {
      if (name in imports) return imports[name]
      throw Error('Unexpected read-model dependency')
    },
  }, { filename })
  return mod.exports
}

async function summaryStatements(rows) {
  const batches = []
  const db = { $transaction: async fn => {
    const queries = []
    await fn({ $executeRawUnsafe: async (text, ...values) => { queries.push({ text, values }); return 0 } })
    batches.push(queries)
  } }
  const readModels = loadTs('src/lib/performance/readModels.ts', {
    '@/lib/db/client': { db },
    '@/lib/datetime': loadTs('src/lib/datetime.ts'),
    '@/lib/reconciliation/duplicateReview': loadTs('src/lib/reconciliation/duplicateReview.ts'),
  })
  await readModels.syncTransactionReadModels(rows.map(row => ({
    ...row, txDateTime: row.txDateTime.replace(' ', 'T') + 'Z',
  })))
  if (batches.length < 2 || batches.flat().length < 4) throw Error('Incomplete summary plan')
  return batches.flat()
}

async function discover() {
  return sql.query(`SELECT t.id,t."accountId",t."batchId",t.source,t.type,t.status,
    t.amount::text,t.currency,t."matchedTxId",t."amountDiff"::text,t."shamCashTxId",
    t."platformTxId",t."platformUserId",t."customerName",t."isInternalTransferAuto",
    t.notes,t."reviewCategory",t."reviewNotes",t."reviewedBy",t."reviewedAt"::text,
    t."txDateTime"::text,t."updatedAt"::text
    FROM transactions t JOIN transactions m ON m.id=t."matchedTxId"
    WHERE upper(btrim(t.currency))<>upper(btrim(m.currency))
    ORDER BY t."accountId",t.id`)
}

async function main() {
  const rows = await discover()
  const byId = new Map(rows.map(row => [row.id, row]))
  const pairs = []
  for (const row of rows) {
    const partner = byId.get(row.matchedTxId)
    if (!partner || partner.matchedTxId !== row.id || partner.accountId !== row.accountId) {
      throw Error('Non-reciprocal or cross-account anomaly needs separate review; no repair started')
    }
    if (row.id < partner.id) pairs.push([row, partner])
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', pairsFound: pairs.length, rowsFound: rows.length }))
  if (!apply || pairs.length === 0) return
  const installed = await sql.query(`SELECT 1 FROM pg_trigger WHERE tgname='transactions_matched_currency_check' AND tgenabled='O'`)
  if (installed.length !== 1) throw Error('Install the database currency guard first')
  let repairedPairs = 0
  while (pairs.length) {
    // At most five pairs from one account per short transaction.
    const accountId = pairs[0][0].accountId
    const batch = []
    while (pairs.length && pairs[0][0].accountId === accountId && batch.length < 5) batch.push(pairs.shift())
    const before = batch.flat()
    const ids = before.map(row => row.id)
    const summaries = await summaryStatements(before)
    const audit = batch.map(pair => ({ id: crypto.randomUUID(), entityId: pair[0].id, details: {
      actor: 'Codex', authorization: 'Explicit user request to repair all cross-currency matches',
      reason: 'Cross-currency pair returned to manual review', partnerId: pair[1].id,
      before: pair,
      after: pair.map(row => ({ id: row.id, status: row.source === 'SHAM_CASH' ? 'PENDING_SC' : 'PENDING_P', matchedTxId: null, amountDiff: null })),
    } }))
    await sql.transaction([
      sql.query(`SET LOCAL lock_timeout='5s'`),
      sql.query(`SET LOCAL statement_timeout='30s'`),
      sql.query(`SELECT id FROM transactions WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]),
      sql.query(`SELECT 1 / CASE WHEN count(*)=$2::int THEN 1 ELSE 0 END AS guard
        FROM transactions t JOIN jsonb_to_recordset($1::jsonb) AS e(id text,"matchedTxId" text,"updatedAt" text)
          ON t.id=e.id AND t."matchedTxId"=e."matchedTxId" AND t."updatedAt"=e."updatedAt"::timestamp`, [JSON.stringify(before), ids.length]),
      sql.query(`UPDATE transactions SET status=CASE WHEN source='SHAM_CASH' THEN 'PENDING_SC'::"TransactionStatus" ELSE 'PENDING_P'::"TransactionStatus" END,
        "matchedTxId"=NULL,"amountDiff"=NULL,"updatedAt"=CURRENT_TIMESTAMP,
        notes=concat_ws(E'\n',nullif(notes,''),'[أعيدت للمراجعة: اختلاف عملة المطابقة]')
        WHERE id=ANY($1::text[])`, [ids]),
      sql.query(`INSERT INTO audit_logs(id,"userId",action,entity,"entityId",details,"createdAt")
        SELECT a.id,NULL,'MANUAL_UNLINK','Transaction',a."entityId",a.details,CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($1::jsonb) AS a(id text,"entityId" text,details jsonb)`, [JSON.stringify(audit)]),
      ...summaries.map(query => sql.query(query.text, query.values)),
      sql.query(`SELECT 1 / CASE WHEN count(*)=$2::int THEN 1 ELSE 0 END AS guard
        FROM transactions t JOIN jsonb_to_recordset($1::jsonb) AS e(id text,amount text,currency text,"reviewCategory" text)
        ON t.id=e.id AND t.amount=e.amount::numeric AND t.currency=e.currency
          AND t."reviewCategory"::text IS NOT DISTINCT FROM e."reviewCategory"
        WHERE t."matchedTxId" IS NULL AND t.status IN ('PENDING_SC','PENDING_P')`, [JSON.stringify(before), ids.length]),
    ], { isolationLevel: 'Serializable' })
    repairedPairs += batch.length
    console.log(JSON.stringify({ repairedPairs }))
  }
  const remaining = await discover()
  console.log(JSON.stringify({ success: remaining.length === 0, repairedPairs, remainingLinkedRows: remaining.length }))
  if (remaining.length) process.exitCode = 1
}

main().catch(error => {
  console.error('Repair stopped safely; completed batches are auditable and resumable.', error.name,
    String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]').slice(0, 160))
  process.exitCode = 1
})
