/* eslint-disable @typescript-eslint/no-explicit-any */
let PrismaClientImpl: any
try {
  PrismaClientImpl = require('@prisma/client').PrismaClient
} catch {
  PrismaClientImpl = class { constructor(_?: unknown) {} }
}

const globalForPrisma = globalThis as unknown as { prisma: any }

// Runtime traffic must use Neon's pooled endpoint. Bound Prisma's local pool
// as well so a scaled Vercel deployment does not exhaust the upstream pool.
// We preserve explicitly supplied values to support local diagnostics.
function pooledRuntimeUrl(value: string | undefined): string | undefined {
  if (!value) return value
  try {
    const url = new URL(value)
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return value
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.DATABASE_CONNECTION_LIMIT || '3')
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT || '10')
    }
    return url.toString()
  } catch {
    // Prisma will produce the actionable connection-string error. Do not hide
    // it behind an additional parsing failure during module initialization.
    return value
  }
}

export const db: any =
  globalForPrisma.prisma ??
  new PrismaClientImpl({
    datasourceUrl: pooledRuntimeUrl(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
