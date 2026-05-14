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

// ─── Timezone-stable calendar-week helpers ──────────────────────────────────
//
// All week/day math below operates on plain `YYYY-MM-DD` calendar strings,
// interpreted in Damascus time. This avoids the classic bug where
// `someDate.toISOString().slice(0,10)` shifts the date backward a day in
// positive-UTC-offset timezones (Syria is UTC+3). Never use toISOString()
// for a *date-only* value — use these helpers instead.

// YYYY-MM-DD for a timestamp, in Damascus time. (Same output as fmtSyriaDate;
// named for intent at call sites that bucket sessions by calendar day.)
export const damascusDateStr = fmtSyriaDate

// Day-of-week index for a YYYY-MM-DD string. 0 = Sunday … 6 = Saturday.
// Parsed as UTC so the result depends only on the calendar date, never on
// the runtime timezone.
export function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay()
}

// Add (or subtract) whole calendar days to a YYYY-MM-DD string. UTC-based so
// there is no DST/offset drift.
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The Sunday that starts the week containing `d`, as a YYYY-MM-DD string in
// Damascus time. Accepts a Date/timestamp (defaults to now) or a YYYY-MM-DD
// string — and is idempotent: passing a Sunday returns that same Sunday.
export function weekStartStr(d: Date | string | number = new Date()): string {
  const ds = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
    ? d.slice(0, 10)
    : damascusDateStr(d)
  return addDays(ds, -dayOfWeek(ds))
}

// The 7 YYYY-MM-DD strings of the week starting at `weekStart` (a Sunday).
export function weekDays(weekStart: string): string[] {
  const start = weekStartStr(weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

// The UTC instant at which a Damascus calendar day begins (00:00:00 +03:00).
// Use this to build DB query windows that align with Damascus calendar days.
export function damascusDayStartUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+03:00`)
}
