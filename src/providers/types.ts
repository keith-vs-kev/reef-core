/**
 * Provider interface — all agent providers implement this contract.
 * Providers receive callbacks for output/events and must NOT import db/events directly.
 */
import type { Provider, ReefEvent } from '../shared-types.js'

export interface AgentProvider {
  name: Provider
  run(ctx: ProviderContext): Promise<void>
}

export interface ProviderContext {
  sessionId: string
  task: string
  model: string
  workdir: string
  onOutput: (line: string) => void
  onEvent: (event: Omit<ReefEvent, 'timestamp'>) => void
  signal: AbortSignal
}
