'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// `/users` and `/employees` were two separate forms managing the same User
// records. They are now unified — every "user" IS an employee record. This
// page redirects to /employees so anyone bookmarked here lands on the
// canonical screen.
export default function UsersRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/employees')
  }, [router])

  return (
    <div className="flex items-center justify-center p-20 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />
      جاري التحويل إلى صفحة الموظفين...
    </div>
  )
}
