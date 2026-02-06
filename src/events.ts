/**
 * reef-core/events.ts — Event bus for WebSocket broadcasting
 */
import { EventEmitter } from 'events';

export interface ReefEvent {
  type: 'output' | 'status' | 'session.new' | 'session.end' | 'tool.start' | 'tool.end';
  sessionId: string;
  data: any;
  timestamp: string;
}

class ReefEventBus extends EventEmitter {
  emit(event: 'reef', payload: ReefEvent): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'reef', listener: (payload: ReefEvent) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

export const eventBus = new ReefEventBus();

export function emitReefEvent(type: ReefEvent['type'], sessionId: string, data: any): void {
  eventBus.emit('reef', {
    type,
    sessionId,
    data,
    timestamp: new Date().toISOString(),
  });
}
