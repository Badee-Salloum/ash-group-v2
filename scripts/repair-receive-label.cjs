/** Dry-run by default. --apply repairs only evidenced zero-valued receives.
 * No deletions, currency changes, consolidation, or employee reassignment.
 * Each account/day batch has a full before/after audit and atomically rebuilt
 * read models. Serializable optimistic guards make interruption resumable.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require('typescript')
const crypto = require('crypto')
const { neon } = require('@neondatabase/serverless')
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw Error('Set DATABASE_URL')
const sql = neon(url)
const apply = process.argv.includes('--apply')
const root = path.resolve(__dirname, '..')
function loadTs(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Date, Intl, console: {
    warn() { throw Error('Summary preparation failed') },
  }, require(name) { if (name in imports) return imports[name]; throw Error('Unexpected dependency') } })
  return mod.exports
}
const { isBrokenReceive, planReceiveRepair } = loadTs('src/lib/reconciliation/receiveLabelRepair.ts', {
  './currencyGuard': loadTs('src/lib/reconciliation/currencyGuard.ts'),
})
const { isSpuriousInternalPair } = loadTs('src/lib/reconciliation/walletMatch.ts')
async function summaries(rows) {
  const batches = []
  const db = { $transaction: async fn => {
    const queries = []
    await fn({ $executeRawUnsafe: async (text, ...values) => { queries.push({ text, values }); return 0 } })
    batches.push(queries)
  } }
  const model = loadTs('src/lib/performance/readModels.ts', {
    '@/lib/db/client': { db }, '@/lib/datetime': loadTs('src/lib/datetime.ts'),
    '@/lib/reconciliation/duplicateReview': loadTs('src/lib/reconciliation/duplicateReview.ts'),
  })
  await model.syncTransactionReadModels(rows.map(row => ({ ...row, txDateTime: row.txDateTime.replace(' ', 'T') + 'Z' })))
  if (batches.flat().length < 4) throw Error('Incomplete read-model plan')
  return batches.flat()
}
const rowJson = `to_jsonb(t)||jsonb_build_object('amount',t.amount::text,'txDateTime',t."txDateTime"::text,'updatedAt',t."updatedAt"::text)`
async function discover() {
  const result = await sql.query(`SELECT ${rowJson} AS row,
    ((t."txDateTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Damascus')::date::text AS day
    FROM transactions t WHERE t.source='SHAM_CASH' AND t.amount=0 AND t."rawData"->>'type'='WITHDRAWAL'
      AND CASE WHEN t."rawData"->>'receivedAmount' ~ '^[0-9]+([.][0-9]+)?$' THEN (t."rawData"->>'receivedAmount')::numeric>0 ELSE false END
      AND t."rawData"->>'sentAmount' ~ '^0([.]0+)?$' ORDER BY t."accountId",day,t.id`)
  return result.map(entry => ({ ...entry.row, day: entry.day }))
}
async function main() {
  const affected = await discover()
  if (!affected.length) { console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', affectedReceives: 0 })); return }
  const accounts = await sql.query(`SELECT id,"walletIdentifiers" FROM accounts WHERE id=ANY($1::text[])`, [[...new Set(affected.map(r => r.accountId))]])
  const wallets = new Map(accounts.map(row => [row.id, row.walletIdentifiers]))
  const partners = await sql.query(`SELECT ${rowJson} AS row FROM transactions t WHERE t.id=ANY($1::text[])
    OR (t.source='PLATFORM' AND t.type='DEPOSIT' AND t.status='PENDING_P' AND t."matchedTxId" IS NULL
      AND t."accountId"=ANY($2::text[]) AND t."shamCashTxId"=ANY($3::text[]))`,
  [affected.map(r => r.matchedTxId).filter(Boolean), accounts.map(r => r.id), affected.map(r => r.shamCashTxId)])
  const byId = new Map(partners.map(entry => [entry.row.id, entry.row]))
  const pending = partners.map(entry => entry.row).filter(row => row.status === 'PENDING_P' && !row.matchedTxId)
  const candidates = new Map()
  const key = r => `${r.accountId}|${r.batchId}|${r.currency.trim().toUpperCase()}|${r.shamCashTxId}`
  for (const p of pending) { const k = key(p); candidates.set(k, [...(candidates.get(k) || []), p]) }
  const used = new Set()
  const plans = affected.map(sc => {
    if (!isBrokenReceive(sc)) throw Error('Unexpected target')
    let partner = sc.matchedTxId ? byId.get(sc.matchedTxId) : undefined
    if (!partner && !sc.matchedTxId) {
      const options = candidates.get(key(sc)) || []
      if (options.length === 1 && !used.has(options[0].id) && !isSpuriousInternalPair({
        scAccountNumber: sc.rawData.accountNumber, scAccountName: sc.rawData.accountName,
        scNotes: sc.rawData.notes, walletIdentifiers: wallets.get(sc.accountId) || [],
        scAmount: Number(sc.rawData.receivedAmount), pAmount: Number(options[0].amount),
      })) partner = options[0]
    }
    if (partner) {
      if (used.has(partner.id)) throw Error('Partner consumed twice; review required')
      used.add(partner.id)
    }
    return { before: partner ? [sc, partner] : [sc], patches: planReceiveRepair(sc, partner),
      accountId: sc.accountId, day: sc.day, newLink: Boolean(partner && !sc.matchedTxId) }
  })
  const groups = new Map()
  for (const plan of plans) { const k = `${plan.accountId}|${plan.day}`; groups.set(k, [...(groups.get(k) || []), plan]) }
  const stats = {
    affectedReceives: plans.length, accountDays: groups.size, accounts: accounts.length,
    newLinks: plans.filter(p => p.newLink).length,
    discrepancyPairs: plans.filter(p => p.patches.length === 2 && p.patches[0].status === 'DISCREPANCY').length,
    sourceAmounts: {}, days: [...new Set(plans.map(p => p.day))].sort(),
  }
  for (const plan of plans) { const c = plan.before[0].currency; stats.sourceAmounts[c] = (stats.sourceAmounts[c] || 0) + Math.round(Number(plan.patches[0].amount) * 100) }
  for (const c of Object.keys(stats.sourceAmounts)) stats.sourceAmounts[c] /= 100
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...stats }))
  if (!apply) return
  let corrected = 0
  for (const group of groups.values()) {
    const before = group.flatMap(plan => plan.before)
    const patches = group.flatMap(plan => plan.patches)
    const queries = await summaries([...before, ...patches.map(p => ({ ...before.find(r => r.id === p.id), ...p }))])
    const auditId = crypto.randomUUID()
    const audit = { actor: 'Codex', authorization: 'Explicit user request to correct past operations',
      reason: 'Receive label استلام previously parsed as WITHDRAWAL', repairVersion: 'receive-label-v1',
      before, after: patches }
    await sql.transaction([
      sql.query(`SET LOCAL lock_timeout='5s'`), sql.query(`SET LOCAL statement_timeout='45s'`),
      sql.query(`SELECT id FROM transactions WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [before.map(r => r.id)]),
      sql.query(`SELECT 1 / CASE WHEN count(*)=$2::int THEN 1 ELSE 0 END FROM transactions t
        JOIN jsonb_to_recordset($1::jsonb) e(id text,"updatedAt" text) ON t.id=e.id AND t."updatedAt"=e."updatedAt"::timestamp`, [JSON.stringify(before), before.length]),
      sql.query(`UPDATE transactions t SET type=p.type::"TransactionType",status=p.status::"TransactionStatus",
        amount=p.amount::numeric,"amountDiff"=p."amountDiff"::numeric,"matchedTxId"=p."matchedTxId",
        "platformTxId"=p."platformTxId","platformUserId"=p."platformUserId","shamCashTxId"=p."shamCashTxId",
        "rawData"=p."rawData",notes=p.notes,"isInternalTransferAuto"=p."isInternalTransferAuto","updatedAt"=CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($1::jsonb) p(id text,type text,status text,amount text,"amountDiff" text,"matchedTxId" text,
          "platformTxId" text,"platformUserId" text,"shamCashTxId" text,"rawData" jsonb,notes text,"isInternalTransferAuto" boolean)
        WHERE t.id=p.id`, [JSON.stringify(patches)]),
      sql.query(`INSERT INTO audit_logs(id,action,entity,"entityId",details,"createdAt") VALUES($1,'REPAIR_RECEIVE_LABEL','Transaction',$2,$3::jsonb,CURRENT_TIMESTAMP)`, [auditId, group[0].before[0].batchId, JSON.stringify(audit)]),
      ...queries.map(q => sql.query(q.text, q.values)),
      sql.query(`SELECT 1 / CASE WHEN count(*)=$2::int THEN 1 ELSE 0 END FROM transactions t
        JOIN jsonb_to_recordset($1::jsonb) p(id text,type text,status text,amount text,"amountDiff" text,"matchedTxId" text)
          ON t.id=p.id AND t.type::text=p.type AND t.status::text=p.status AND t.amount=p.amount::numeric
          AND t."amountDiff" IS NOT DISTINCT FROM p."amountDiff"::numeric AND t."matchedTxId" IS NOT DISTINCT FROM p."matchedTxId"`, [JSON.stringify(patches), patches.length]),
    ], { isolationLevel: 'Serializable' })
    corrected += group.length
    console.log(JSON.stringify({ correctedReceives: corrected }))
  }
  const remaining = await discover()
  console.log(JSON.stringify({ success: remaining.length === 0, correctedReceives: corrected, remaining: remaining.length }))
  if (remaining.length) process.exitCode = 1
}
main().catch(error => {
  console.error('Repair stopped; completed groups are audited and resumable.', error.name,
    String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]').slice(0, 180))
  process.exitCode = 1
})
