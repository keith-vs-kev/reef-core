/**
 * reef-core/events.ts — Event bus for WebSocket broadcasting
 */
import { EventEmitter } from 'events'
import type { ReefEvent, ReefEventType } from './shared-types.js'

export type { ReefEvent } from './shared-types.js'

class ReefEventBus extends EventEmitter {
  emitReef(payload: ReefEvent): boolean {
    return super.emit('reef', payload)
  }

  onReef(listener: (payload: ReefEvent) => void): this {
    return super.on('reef', listener)
  }
}

export const eventBus = new ReefEventBus()

export function emitReefEvent(
  type: ReefEventType,
  sessionId: string,
  data: Record<string, unknown>
): void {
  eventBus.emitReef({
    type,
    sessionId,
    data,
    timestamp: new Date().toISOString(),
  } as ReefEvent)
}
