/**
 * SessionManager — owns session lifecycle, running sessions map, tmux coordination
 */
import crypto from 'crypto'
import type { SessionRow } from './db.js'
import { insertSession, updateSession, appendOutput } from './db.js'
import { emitReefEvent } from './events.js'
import {
  spawnAgent as spawnTmuxAgent,
  killSession as killTmuxSession,
  captureOutput,
  sessionExists,
} from './tmux.js'

/** Opaque Pi SDK session */
interface PiSession {
  subscribe: (listener: (event: PiSdkEvent) => void) => () => void
  prompt: (text: string) => Promise<void>
  agent?: { abort: () => void }
}

interface PiSdkEvent {
  type: string
  assistantMessageEvent?: {
    type: string
    content?: { type: string; text?: string }
  }
  message?: { role: string; content: unknown }
  toolName?: string
  toolCallId?: string
  args?: unknown
  isError?: boolean
}

interface ContentBlock {
  type: string
  text?: string
}

interface RunningSession {
  session: PiSession
  unsubscribe: () => void
  abortController: AbortController
}

interface RunningProviderSession {
  abortController: AbortController
}

// Pi SDK dynamic imports
let piSdkAvailable = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createAgentSession: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getModel: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PiSessionManager: any

async function loadPiSdk(): Promise<boolean> {
  try {
    const codingAgent = await import('@mariozechner/pi-coding-agent')
    createAgentSession = codingAgent.createAgentSession
    PiSessionManager = codingAgent.SessionManager
    const ai = await import('@mariozechner/pi-ai')
    getModel = ai.getModel
    piSdkAvailable = true
    console.log('✅ Pi SDK loaded successfully')
    return true
  } catch (err) {
    console.warn('⚠️  Pi SDK not available, using tmux fallback:', (err as Error).message)
    piSdkAvailable = false
    return false
  }
}

function uid(): string {
  return crypto.randomBytes(6).toString('hex')
}

function summarizeArgs(args: unknown): string {
  if (!args) return ''
  if (typeof args === 'string') return args.slice(0, 80)
  const obj = args as Record<string, unknown>
  if (typeof obj.command === 'string') return obj.command.slice(0, 80)
  if (typeof obj.file_path === 'string') return obj.file_path
  if (typeof obj.path === 'string') return obj.path as string
  return JSON.stringify(args).slice(0, 80)
}

export class SessionManager {
  private sdkSessions = new Map<string, RunningSession>()
  private providerSessions = new Map<string, RunningProviderSession>()
  private sdkReady: Promise<boolean>

  constructor() {
    this.sdkReady = loadPiSdk()
  }

  async waitForSdk(): Promise<void> {
    await this.sdkReady
  }

  generateId(): string {
    return uid()
  }

  isPiSdkAvailable(): boolean {
    return piSdkAvailable
  }

  // ── SDK (Anthropic) sessions ──

  async spawnSdkSession(
    sessionId: string,
    task: string,
    model: string | undefined,
    workdir: string
  ): Promise<SessionRow> {
    const resolvedModel = model
      ? getModel('anthropic', model)
      : getModel('anthropic', 'claude-sonnet-4-20250514')

    const { session } = await createAgentSession({
      cwd: workdir,
      model: resolvedModel,
      sessionManager: PiSessionManager.inMemory(),
    })

    const now = new Date().toISOString()
    const row: SessionRow = {
      id: sessionId,
      task,
      status: 'running',
      backend: 'sdk',
      model: resolvedModel.id,
      created_at: now,
      updated_at: now,
      output: [],
    }
    insertSession(row)
    emitReefEvent('session.new', sessionId, { task, backend: 'sdk', model: resolvedModel.id })

    const unsubscribe = session.subscribe((event: PiSdkEvent) => {
      this.handleSdkEvent(sessionId, event)
    })

    const abortController = new AbortController()
    this.sdkSessions.set(sessionId, { session, unsubscribe, abortController })

    session
      .prompt(task)
      .then(() => {
        updateSession(sessionId, { status: 'completed' })
        emitReefEvent('status', sessionId, { status: 'completed' })
        emitReefEvent('session.end', sessionId, { reason: 'completed' })
        this.sdkSessions.delete(sessionId)
      })
      .catch((err: Error) => {
        const msg = `Error: ${err.message}`
        appendOutput(sessionId, msg)
        emitReefEvent('output', sessionId, { text: msg })
        updateSession(sessionId, { status: 'error' })
        emitReefEvent('status', sessionId, { status: 'error', error: err.message })
        this.sdkSessions.delete(sessionId)
      })

    return row
  }

  // ── Tmux sessions ──

  spawnTmuxSession(sessionId: string, task: string, workdir?: string): SessionRow {
    const tmux = spawnTmuxAgent(task, workdir)
    const now = new Date().toISOString()
    const row: SessionRow = {
      id: sessionId,
      task,
      status: 'running',
      backend: 'tmux',
      tmux_session: tmux.tmuxSession,
      created_at: now,
      updated_at: now,
      output: [],
    }
    insertSession(row)
    emitReefEvent('session.new', sessionId, { task, backend: 'tmux' })
    return row
  }

  // ── Provider sessions (OpenAI, Google via registry) ──

  registerProviderRun(sessionId: string, abortController: AbortController): void {
    this.providerSessions.set(sessionId, { abortController })
  }

  completeProviderSession(sessionId: string): void {
    this.providerSessions.delete(sessionId)
  }

  createProviderRow(sessionId: string, task: string, provider: string, model: string): SessionRow {
    const now = new Date().toISOString()
    const row: SessionRow = {
      id: sessionId,
      task,
      status: 'running',
      backend: provider as SessionRow['backend'],
      provider: provider as SessionRow['provider'],
      model,
      created_at: now,
      updated_at: now,
      output: [],
    }
    insertSession(row)
    emitReefEvent('session.new', sessionId, { task, backend: provider, model, provider })
    return row
  }

  // ── Lifecycle ──

  async sendMessage(sessionId: string, message: string): Promise<boolean> {
    const running = this.sdkSessions.get(sessionId)
    if (!running) return false
    try {
      await running.session.prompt(message)
      return true
    } catch {
      return false
    }
  }

  kill(sessionId: string, row: SessionRow): void {
    // SDK session
    const sdkSession = this.sdkSessions.get(sessionId)
    if (sdkSession) {
      sdkSession.session.agent?.abort()
      sdkSession.unsubscribe()
      this.sdkSessions.delete(sessionId)
    }

    // Provider session
    const provSession = this.providerSessions.get(sessionId)
    if (provSession) {
      provSession.abortController.abort()
      this.providerSessions.delete(sessionId)
    }

    // Tmux session
    if (row.tmux_session) {
      killTmuxSession(row.tmux_session)
    }

    emitReefEvent('session.end', sessionId, { reason: 'killed' })
  }

  getOutput(sessionId: string, row: SessionRow): string {
    if (row.backend === 'sdk') return row.output.join('\n')
    if (row.tmux_session) return captureOutput(row.tmux_session)
    // Provider sessions store in DB
    return row.output.join('\n')
  }

  isAlive(sessionId: string, row: SessionRow): boolean {
    if (row.backend === 'sdk') return this.sdkSessions.has(sessionId)
    if (row.tmux_session) return sessionExists(row.tmux_session)
    // Provider sessions
    return this.providerSessions.has(sessionId)
  }

  getStats(): { sdk: number; tmux: number; provider: number; total: number } {
    return {
      sdk: this.sdkSessions.size,
      tmux: 0,
      provider: this.providerSessions.size,
      total: this.sdkSessions.size + this.providerSessions.size,
    }
  }

  // ── SDK event handling ──

  private handleSdkEvent(sessionId: string, event: PiSdkEvent): void {
    switch (event.type) {
      case 'message_update': {
        const msg = event.assistantMessageEvent
        if (msg?.type === 'content' && msg.content?.type === 'text') {
          const text = msg.content.text || ''
          if (text) {
            appendOutput(sessionId, text)
            emitReefEvent('output', sessionId, { text, streaming: true })
          }
        }
        break
      }
      case 'message_end': {
        const message = event.message
        if (message?.role === 'assistant') {
          const content = Array.isArray(message.content)
            ? (message.content as ContentBlock[])
                .filter((c) => c.type === 'text')
                .map((c) => c.text || '')
                .join('')
            : String(message.content || '')
          if (content) {
            emitReefEvent('output', sessionId, { text: content, complete: true })
          }
        }
        break
      }
      case 'tool_execution_start':
        emitReefEvent('tool.start', sessionId, {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
        })
        appendOutput(sessionId, `⚡ ${event.toolName}(${summarizeArgs(event.args)})`)
        break
      case 'tool_execution_end':
        emitReefEvent('tool.end', sessionId, {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isError: event.isError,
        })
        break
      case 'turn_start':
        emitReefEvent('output', sessionId, { text: '--- turn ---', meta: true })
        break
    }
  }
}
