import { AsyncLocalStorage } from 'node:async_hooks'

export interface AuditContext {
  actorType: 'HUMAN' | 'SERVICE' | 'SYSTEM' | 'UNKNOWN'
  authMethod: 'SESSION' | 'OPS_TOKEN' | 'CRON_SECRET' | 'INTERNAL' | 'UNSPECIFIED'
  actorUserId: string | null
  requestId: string
  operationId?: string
  reason?: string
}
const storage = new AsyncLocalStorage<AuditContext>()
export function currentAuditContext() { return storage.getStore() }
export function withAuditContext<T>(context: AuditContext, fn: () => T): T { return storage.run(context, fn) }
export function getAuditMetadata(): AuditContext {
  return storage.getStore() || { actorType: 'UNKNOWN', authMethod: 'UNSPECIFIED', actorUserId: null, requestId: crypto.randomUUID() }
}
