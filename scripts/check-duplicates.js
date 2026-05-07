const XLSX = require('xlsx')
const fs = require('fs')

const files = [
  'C:\\Users\\Badee Salloum\\Desktop\\New folder (9)\\sham_cash_report_20260424_003802.xlsx',
  'C:\\Users\\Badee Salloum\\Desktop\\New folder (9)\\epaylist (3).xlsx',
  'C:\\Users\\Badee Salloum\\Desktop\\New folder (9)\\epayquery (2).xlsx',
]

for (const f of files) {
  console.log('\n=== ' + f.split('\\').pop() + ' ===')
  const wb = XLSX.readFile(f)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  console.log('Row count:', rows.length)
  if (rows.length === 0) continue
  const cols = Object.keys(rows[0])
  console.log('Columns:', cols.slice(0, 10))

  // Find duplicate TX IDs
  const idField = cols.find(c => /رقم.*عملية|Transaction ID|رقم العملية/i.test(c)) || cols[0]
  console.log('ID field:', idField)
  const ids = rows.map(r => String(r[idField] || ''))
  const counts = {}
  for (const id of ids) counts[id] = (counts[id] || 0) + 1
  const dups = Object.entries(counts).filter(([, n]) => n > 1)
  console.log('Duplicate IDs:', dups.length)
  if (dups.length > 0) {
    for (const [id, n] of dups.slice(0, 10)) {
      console.log('  ' + id + ' → ' + n + ' occurrences')
      // Print first row with this id
      const sample = rows.find(r => String(r[idField]) === id)
      console.log('    Sample:', Object.entries(sample).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' | '))
    }
  }

  // Check specific IDs from screenshot
  const targetsMapping = {
    '192365713': 'هيثم بديع علي',
    '191780129': 'علي محمد حمدوش',
    '191708365': '(Platform-only deposit)',
  }
  console.log('\nSearches for specific IDs from screenshot:')
  for (const [tgt] of Object.entries(targetsMapping)) {
    const matches = rows.filter(r => JSON.stringify(r).includes(tgt))
    console.log(`  ${tgt}: ${matches.length} row(s)`)
    for (const m of matches.slice(0, 3)) {
      console.log('    ' + Object.entries(m).slice(0, 8).map(([k, v]) => `${k}=${String(v).slice(0,30)}`).join(' | '))
    }
  }
}
