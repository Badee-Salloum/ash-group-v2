import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Admin user
  const adminPassword = await bcrypt.hash('Admin@123456', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@platform.local' },
    update: {},
    create: {
      name: 'مدير النظام',
      email: 'admin@platform.local',
      passwordHash: adminPassword,
      role: 'ADMIN',
      twoFactorEnabled: false,
    },
  })
  console.log('Admin user created:', admin.email)

  // Sample account
  const account = await prisma.account.upsert({
    where: { id: 'acc_main_001' },
    update: {},
    create: {
      id: 'acc_main_001',
      name: 'الحساب الرئيسي - شام كاش USD',
      currency: 'USD',
      depositProfitRate: 2.5,
      withdrawalProfitRate: 1.5,
      walletIdentifiers: [],
    },
  })
  console.log('Sample account created:', account.name)

  console.log('\nLogin credentials:')
  console.log('   Email:    admin@platform.local')
  console.log('   Password: Admin@123456')
  console.log('\n   Please change the password after first login!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
