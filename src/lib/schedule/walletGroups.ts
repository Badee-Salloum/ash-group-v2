// Phase F — wallet-shared employee groupings. Pure logic, no I/O.

export interface ShiftRow {
  userId: string
  walletIds: string[]
}

export interface EmployeeRef {
  id: string
  name: string
}

export interface WalletGroup {
  key: string
  walletIds: string[]
  employees: EmployeeRef[]
}

// Stable key for a wallet set — sorted unique-joined. Two arrays with the
// same members in any order yield the same key.
export function walletSetKey(ids: string[]): string {
  return [...new Set(ids)].sort().join('|')
}

export interface ComputeInput {
  shifts: ShiftRow[]
  employees: EmployeeRef[]
}

// Build wallet groups from the current week's shifts.
//
// Algorithm:
//   1. For each (userId, walletIds[]), union all walletIds across the week
//      into a single Set per employee.
//   2. Filter out anyone outside the allowed employees list (manager scope).
//   3. Filter out anyone with zero wallets.
//   4. Bucket employees by walletSetKey (strict set-equality).
//   5. Return groups in deterministic order (key asc, members by name).
export function computeWalletGroups({ shifts, employees }: ComputeInput): WalletGroup[] {
  const allowed = new Set(employees.map(e => e.id))
  const byId = new Map(employees.map(e => [e.id, e]))

  const empWallets = new Map<string, Set<string>>()
  for (const s of shifts) {
    if (!s.userId || !allowed.has(s.userId)) continue
    let set = empWallets.get(s.userId)
    if (!set) { set = new Set(); empWallets.set(s.userId, set) }
    for (const w of s.walletIds || []) set.add(w)
  }

  const buckets = new Map<string, string[]>()
  for (const [uid, set] of empWallets) {
    if (set.size === 0) continue
    const key = walletSetKey([...set])
    const arr = buckets.get(key)
    if (arr) arr.push(uid); else buckets.set(key, [uid])
  }

  const groups: WalletGroup[] = []
  for (const [key, uids] of buckets) {
    const members = uids
      .map(uid => byId.get(uid))
      .filter((e): e is EmployeeRef => Boolean(e))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    groups.push({ key, walletIds: key.split('|'), employees: members })
  }
  groups.sort((a, b) => a.key.localeCompare(b.key))
  return groups
}

export interface CoverageWarnInput {
  group: WalletGroup
  // userId → YYYY-MM-DD off-day
  picks: Map<string, string>
  weekDates: string[]
}

export interface CoverageWarning {
  // YYYY-MM-DD → number of group members off that day
  perDay: Record<string, number>
  // Days where remaining workers < 2.
  redDays: string[]
}

// Per-group coverage breakdown. Red when picks leave fewer than 2 members
// working — `count > size − 2`. Size 1/2 groups can't meet that floor;
// they're never marked red here (callers should still warn about size).
export function coverageWarning({ group, picks, weekDates }: CoverageWarnInput): CoverageWarning {
  const perDay: Record<string, number> = Object.fromEntries(weekDates.map(d => [d, 0]))
  const memberIds = new Set(group.employees.map(e => e.id))
  for (const [uid, d] of picks) {
    if (memberIds.has(uid) && d && perDay[d] !== undefined) {
      perDay[d]!++
    }
  }
  const size = group.employees.length
  const threshold = size - 2
  const redDays: string[] = []
  if (threshold >= 0) {
    for (const d of weekDates) {
      if (perDay[d]! > threshold) redDays.push(d)
    }
  }
  return { perDay, redDays }
}
