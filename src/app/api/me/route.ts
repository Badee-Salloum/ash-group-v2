import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db/client'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true, name: true, email: true, role: true,
      employeeCode: true, jobTitle: true, hireDate: true,
      baseSalary: true, phone: true, avatarUrl: true,
      managerId: true,
    },
  })

  if (!user) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })

  return NextResponse.json({
    success: true,
    id: user.id,
    ...user,
    baseSalary: user.baseSalary ? Number(user.baseSalary) : null,
  })
}
