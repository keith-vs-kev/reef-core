/**
 * reef-core/agent.ts — Thin orchestrator wiring SessionManager + ProviderRouter
 *
 * Routes spawn requests to the appropriate backend:
 * - OpenAI/Google → ProviderRouter (registry-based providers)
 * - Anthropic → SessionManager (Pi SDK special case, or tmux fallback)
 */
import type { SessionRow } from './db.js'
import { SessionManager } from './session-manager.js'
import { ProviderRouter } from './provider-router.js'

// Singletons
const sessionMgr = new SessionManager()
const providerRouter = new ProviderRouter(sessionMgr)

export interface SpawnOptions {
  task: string
  workdir?: string
  model?: string
  provider?: 'anthropic' | 'openai' | 'google'
  forceBackend?: 'sdk' | 'tmux'
}

export interface SpawnResult {
  sessionId: string
  backend: 'sdk' | 'tmux' | 'openai' | 'google'
  row: SessionRow
}

/**
 * Spawn an agent session.
 */
export async function spawn(opts: SpawnOptions): Promise<SpawnResult> {
  await sessionMgr.waitForSdk()

  const sessionId = sessionMgr.generateId()
  const provider = opts.provider || 'anthropic'

  // Route OpenAI/Google through provider registry
  if (provider === 'openai' || provider === 'google') {
    const row = await providerRouter.route(sessionId, opts.task, provider, opts.model, opts.workdir)
    return { sessionId, backend: provider, row }
  }

  // Anthropic: Pi SDK or tmux fallback
  // Pi SDK uses a fundamentally different session model (createAgentSession + subscribe/prompt)
  // that doesn't fit the simple AgentProvider.run() interface, so it's a special case.
  const backend = opts.forceBackend || (sessionMgr.isPiSdkAvailable() ? 'sdk' : 'tmux')
  if (backend === 'sdk') {
    try {
      const row = await sessionMgr.spawnSdkSession(
        sessionId,
        opts.task,
        opts.model,
        opts.workdir || process.cwd()
      )
      return { sessionId, backend: 'sdk', row }
    } catch (err) {
      console.warn(
        `SDK spawn failed for ${sessionId}, falling back to tmux:`,
        (err as Error).message
      )
      const row = sessionMgr.spawnTmuxSession(sessionId, opts.task, opts.workdir)
      return { sessionId, backend: 'tmux', row }
    }
  }

  const row = sessionMgr.spawnTmuxSession(sessionId, opts.task, opts.workdir)
  return { sessionId, backend: 'tmux', row }
}

export async function sendMessage(sessionId: string, message: string): Promise<boolean> {
  return sessionMgr.sendMessage(sessionId, message)
}

export function kill(sessionId: string, row: SessionRow): void {
  sessionMgr.kill(sessionId, row)
}

export function getOutput(sessionId: string, row: SessionRow): string {
  return sessionMgr.getOutput(sessionId, row)
}

export function isAlive(sessionId: string, row: SessionRow): boolean {
  return sessionMgr.isAlive(sessionId, row)
}

export function getStats(): { sdk: number; tmux: number; total: number } {
  const stats = sessionMgr.getStats()
  return { sdk: stats.sdk, tmux: stats.tmux, total: stats.total }
}
