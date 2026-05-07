import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

interface TreeNode {
  id: string
  name: string
  jobTitle: string | null
  employeeCode: string | null
  role: string
  avatarUrl: string | null
  children: TreeNode[]
}

// Build the org-chart tree from User self-relation (managerId).
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const users = await db.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        employeeCode: true,
        role: true,
        avatarUrl: true,
        managerId: true,
      },
    })

    // Build a map and assemble the tree
    const map = new Map<string, TreeNode>()
    for (const u of users) {
      map.set(u.id, {
        id: u.id,
        name: u.name,
        jobTitle: u.jobTitle,
        employeeCode: u.employeeCode,
        role: u.role,
        avatarUrl: u.avatarUrl,
        children: [],
      })
    }

    const roots: TreeNode[] = []
    for (const u of users) {
      const node = map.get(u.id)!
      if (u.managerId && map.has(u.managerId)) {
        map.get(u.managerId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return NextResponse.json({ success: true, data: roots })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
