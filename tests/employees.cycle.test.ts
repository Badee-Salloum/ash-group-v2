import { describe, it, expect } from 'vitest'

// Pure graph helper extracted from /api/employees PUT — detects whether a
// candidate manager would create a cycle (i.e. they're a descendant of the
// employee being edited).

interface UserNode { id: string; managerId: string | null }

function isDescendant(
  candidateManagerId: string,
  employeeId: string,
  allUsers: UserNode[],
): boolean {
  const descendants = new Set<string>([employeeId])
  let changed = true
  while (changed) {
    changed = false
    for (const u of allUsers) {
      if (u.managerId && descendants.has(u.managerId) && !descendants.has(u.id)) {
        descendants.add(u.id); changed = true
      }
    }
  }
  return descendants.has(candidateManagerId)
}

describe('manager cycle prevention', () => {
  it('flat: no descendants → safe', () => {
    const users: UserNode[] = [
      { id: 'A', managerId: null },
      { id: 'B', managerId: null },
    ]
    expect(isDescendant('B', 'A', users)).toBe(false)
  })

  it('direct subordinate as manager → cycle', () => {
    const users: UserNode[] = [
      { id: 'BOSS', managerId: null },
      { id: 'EMP',  managerId: 'BOSS' },
    ]
    expect(isDescendant('EMP', 'BOSS', users), 'BOSS cannot have their direct report as manager').toBe(true)
  })

  it('indirect subordinate (grandchild) as manager → cycle', () => {
    const users: UserNode[] = [
      { id: 'GRANDPA', managerId: null },
      { id: 'PARENT',  managerId: 'GRANDPA' },
      { id: 'CHILD',   managerId: 'PARENT' },
    ]
    expect(isDescendant('CHILD', 'GRANDPA', users), 'CHILD is indirect subordinate').toBe(true)
  })

  it('5-deep indirect descendant → cycle', () => {
    const users: UserNode[] = [
      { id: '1', managerId: null },
      { id: '2', managerId: '1' },
      { id: '3', managerId: '2' },
      { id: '4', managerId: '3' },
      { id: '5', managerId: '4' },
    ]
    expect(isDescendant('5', '1', users)).toBe(true)
  })

  it('peer (sibling) is NOT a descendant → safe to assign', () => {
    const users: UserNode[] = [
      { id: 'BOSS', managerId: null },
      { id: 'A', managerId: 'BOSS' },
      { id: 'B', managerId: 'BOSS' },
    ]
    expect(isDescendant('B', 'A', users)).toBe(false)
  })

  it('superior is NOT a descendant → safe', () => {
    const users: UserNode[] = [
      { id: 'BOSS', managerId: null },
      { id: 'EMP',  managerId: 'BOSS' },
    ]
    expect(isDescendant('BOSS', 'EMP', users)).toBe(false)
  })

  it('disconnected subtree → safe', () => {
    const users: UserNode[] = [
      { id: 'X1', managerId: null }, { id: 'X2', managerId: 'X1' },
      { id: 'Y1', managerId: null }, { id: 'Y2', managerId: 'Y1' },
    ]
    expect(isDescendant('Y2', 'X1', users)).toBe(false)
  })

  it('self as manager → cycle (degenerate)', () => {
    const users: UserNode[] = [{ id: 'A', managerId: null }]
    expect(isDescendant('A', 'A', users)).toBe(true)
  })
})
