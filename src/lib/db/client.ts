/* eslint-disable @typescript-eslint/no-explicit-any */
let PrismaClientImpl: any
try {
  PrismaClientImpl = require('@prisma/client').PrismaClient
} catch {
  PrismaClientImpl = class { constructor(_?: unknown) {} }
}

const globalForPrisma = globalThis as unknown as { prisma: any }

export const db: any =
  globalForPrisma.prisma ??
  new PrismaClientImpl({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
