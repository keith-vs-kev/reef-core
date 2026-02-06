/**
 * Provider registry — maps provider names to AgentProvider implementations
 */
import type { Provider } from '../shared-types.js'
import type { AgentProvider } from './types.js'
import { openaiProvider } from './openai.js'
import { googleProvider } from './google.js'

export type { AgentProvider, ProviderContext } from './types.js'

const registry = new Map<Provider, AgentProvider>()

registry.set('openai', openaiProvider)
registry.set('google', googleProvider)
// NOTE: Anthropic uses the Pi SDK which has a fundamentally different session model
// (createAgentSession + subscribe/prompt). It's handled as a special case in SessionManager
// because it can't conform to the simple run(ctx) interface without losing features
// (streaming events, abort via session.agent.abort(), etc.)

export function getProvider(name: Provider): AgentProvider | undefined {
  return registry.get(name)
}

export function hasProvider(name: Provider): boolean {
  return registry.has(name)
}

export function listProviders(): Provider[] {
  return [...registry.keys()]
}
