import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('auth_token')
  response.cookies.delete('last_activity')
  response.cookies.delete('pending_2fa')
  return response
}
