// Legacy /bonuses route — content moved into /compensation as a tab.
// Bookmarks land on the same view via redirect.

import { redirect } from 'next/navigation'

export default function BonusesPage() {
  redirect('/compensation?tab=bonuses')
}
