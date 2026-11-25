// Legacy /bonus-rules route — content moved into /compensation as a tab.
// Bookmarks land on the same view via redirect.

import { redirect } from 'next/navigation'

export default function BonusRulesPage() {
  redirect('/compensation?tab=rules')
}
