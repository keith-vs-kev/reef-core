/**
 * ProviderRouter — selects and invokes the right provider from the registry
 */
import type { Provider } from './shared-types.js'
import type { ProviderContext } from './providers/types.js'
import { getProvider } from './providers/index.js'
import { appendOutput, updateSession } from './db.js'
import { emitReefEvent } from './events.js'
import { SessionManager } from './session-manager.js'

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
}

export class ProviderRouter {
  constructor(private sessionMgr: SessionManager) {}

  /**
   * Route a task to the appropriate provider and run it.
   * Returns the session row. The provider runs asynchronously.
   */
  async route(
    sessionId: string,
    task: string,
    provider: Provider,
    model?: string,
    workdir?: string
  ) {
    const resolvedModel = model || DEFAULT_MODELS[provider] || 'unknown'
    const resolvedWorkdir = workdir || process.cwd()

    // Check registry for provider
    const agentProvider = getProvider(provider)
    if (!agentProvider) {
      throw new Error(`No provider registered for: ${provider}`)
    }

    const row = this.sessionMgr.createProviderRow(sessionId, task, provider, resolvedModel)

    const abortController = new AbortController()
    this.sessionMgr.registerProviderRun(sessionId, abortController)

    const ctx: ProviderContext = {
      sessionId,
      task,
      model: resolvedModel,
      workdir: resolvedWorkdir,
      onOutput: (line: string) => appendOutput(sessionId, line),
      onEvent: (event) => {
        emitReefEvent(event.type, event.sessionId, event.data as Record<string, unknown>)
      },
      signal: abortController.signal,
    }

    // Run async — don't await
    agentProvider
      .run(ctx)
      .then(() => {
        updateSession(sessionId, { status: 'completed' })
        emitReefEvent('status', sessionId, { status: 'completed' })
        emitReefEvent('session.end', sessionId, { reason: 'completed' })
        this.sessionMgr.completeProviderSession(sessionId)
      })
      .catch((err: Error) => {
        const msg = `Error: ${err.message}`
        appendOutput(sessionId, msg)
        emitReefEvent('output', sessionId, { text: msg })
        updateSession(sessionId, { status: 'error' })
        emitReefEvent('status', sessionId, { status: 'error', error: err.message })
        this.sessionMgr.completeProviderSession(sessionId)
      })

    return row
  }
}
