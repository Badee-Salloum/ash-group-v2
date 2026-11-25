import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'

export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const secret = authenticator.generateSecret()
    const otpauth = authenticator.keyuri(session.email, 'Financial Platform', secret)
    const qrCodeUrl = await QRCode.toDataURL(otpauth)

    return NextResponse.json({
      success: true,
      data: { secret, qrCodeUrl },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
