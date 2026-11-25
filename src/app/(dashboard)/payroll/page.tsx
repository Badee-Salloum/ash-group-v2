// Legacy /payroll route — content moved into /compensation as a tab.
// Bookmarks land on the same view via redirect.

import { redirect } from 'next/navigation'

export default function PayrollPage() {
  redirect('/compensation?tab=payroll')
}
