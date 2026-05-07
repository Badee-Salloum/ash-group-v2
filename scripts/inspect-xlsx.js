const XLSX = require('xlsx')
const files = [
  'C:\\Users\\Badee Salloum\\Desktop\\New folder (8)\\epaylist (2).xlsx',
  'C:\\Users\\Badee Salloum\\Desktop\\New folder (8)\\epayquery (1).xlsx',
]
for (const f of files) {
  console.log('\n=== ' + f.split('\\').pop() + ' ===')
  const wb = XLSX.readFile(f)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  console.log('Row count:', rows.length)
  if (rows.length > 0) {
    console.log('Columns:', Object.keys(rows[0]))
    console.log('\nFirst 2 rows:')
    rows.slice(0, 2).forEach((r, i) => {
      console.log(`Row ${i+1}:`)
      for (const [k, v] of Object.entries(r)) {
        const s = String(v)
        console.log('  ' + k + ': ' + (s.length > 120 ? s.slice(0, 120) + '...' : s))
      }
    })
  }
}
