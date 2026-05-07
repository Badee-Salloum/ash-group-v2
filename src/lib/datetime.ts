// Display dates in Syria local time (Asia/Damascus, UTC+3) regardless of the
// viewer's browser timezone — so the times shown on the site always match the
// original times from the Sham Cash / Platform Excel files.

export function fmtSyria(d: Date | string | number, withSeconds = true): string {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  const sec = withSeconds ? `:${get('second')}` : ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}${sec}`
}

// Sunday-aligned start-of-week (matches the rest of the app).
export function startOfWeek(d: Date | string): Date {
  const date = typeof d === 'string' ? new Date(d) : new Date(d)
  const day = date.getDay()
  const m = new Date(date)
  m.setDate(date.getDate() - day)
  m.setHours(0, 0, 0, 0)
  return m
}

export function endOfWeek(d: Date | string): Date {
  const ws = startOfWeek(d)
  const e = new Date(ws)
  e.setDate(e.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

export function fmtSyriaDate(d: Date | string | number): string {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
