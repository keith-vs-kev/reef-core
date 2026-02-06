/**
 * reef-core/agent.ts — Pi SDK agent management
 * 
 * Uses @mariozechner/pi-coding-agent createAgentSession() for proper
 * streaming, events, and tool use visibility.
 * Falls back to tmux if SDK fails.
 */
import crypto from 'crypto';
import { type SessionRow, insertSession, updateSession, appendOutput } from './db.js';
import { emitReefEvent } from './events.js';
import { spawnAgent as spawnTmuxAgent, killSession as killTmuxSession, captureOutput, sessionExists } from './tmux.js';
import { runOpenAIAgent } from './providers/openai.js';
import { runGoogleAgent } from './providers/google.js';

// Dynamic imports for Pi SDK (may not be available)
let piSdkAvailable = false;
let createAgentSession: any;
let getModel: any;
let SessionManager: any;

async function loadPiSdk(): Promise<boolean> {
  try {
    const codingAgent = await import('@mariozechner/pi-coding-agent');
    createAgentSession = codingAgent.createAgentSession;
    SessionManager = codingAgent.SessionManager;
    const ai = await import('@mariozechner/pi-ai');
    getModel = ai.getModel;
    piSdkAvailable = true;
    console.log('✅ Pi SDK loaded successfully');
    return true;
  } catch (err) {
    console.warn('⚠️  Pi SDK not available, using tmux fallback:', (err as Error).message);
    piSdkAvailable = false;
    return false;
  }
}

// Initialize on module load
const sdkReady = loadPiSdk();

// Track running SDK sessions
const runningSessions = new Map<string, {
  session: any;  // AgentSession
  unsubscribe: () => void;
  abortController: AbortController;
}>();

function uid(): string {
  return crypto.randomBytes(6).toString('hex');
}

export interface SpawnOptions {
  task: string;
  workdir?: string;
  model?: string;
  provider?: 'anthropic' | 'openai' | 'google';
  forceBackend?: 'sdk' | 'tmux';
}

export interface SpawnResult {
  sessionId: string;
  backend: 'sdk' | 'tmux' | 'openai' | 'google';
  row: SessionRow;
}

/**
 * Spawn an agent session. Tries Pi SDK first, falls back to tmux.
 */
export async function spawn(opts: SpawnOptions): Promise<SpawnResult> {
  await sdkReady;
  
  const sessionId = uid();
  const now = new Date().toISOString();
  const provider = opts.provider || 'anthropic';

  // Route to provider-specific agents
  if (provider === 'openai') {
    return spawnProviderAgent(sessionId, opts, now, 'openai');
  }
  if (provider === 'google') {
    return spawnProviderAgent(sessionId, opts, now, 'google');
  }

  // Anthropic: use existing SDK/tmux path
  const backend = opts.forceBackend || (piSdkAvailable ? 'sdk' : 'tmux');
  if (backend === 'sdk') {
    return spawnSdkAgent(sessionId, opts, now);
  } else {
    return spawnTmuxFallback(sessionId, opts, now);
  }
}

async function spawnProviderAgent(
  sessionId: string,
  opts: SpawnOptions,
  now: string,
  provider: 'openai' | 'google',
): Promise<SpawnResult> {
  const defaultModels = {
    openai: 'gpt-4o',
    google: 'gemini-2.5-flash',
  };
  const model = opts.model || defaultModels[provider];
  const workdir = opts.workdir || process.cwd();

  const row: SessionRow = {
    id: sessionId,
    task: opts.task,
    status: 'running',
    backend: provider,
    provider,
    model,
    created_at: now,
    updated_at: now,
    output: [],
  };
  insertSession(row);
  emitReefEvent('session.new', sessionId, { task: opts.task, backend: provider, model, provider });

  // Run asynchronously
  const runner = provider === 'openai'
    ? runOpenAIAgent(sessionId, opts.task, model, workdir)
    : runGoogleAgent(sessionId, opts.task, model, workdir);

  runner.then(() => {
    updateSession(sessionId, { status: 'completed' });
    emitReefEvent('status', sessionId, { status: 'completed' });
    emitReefEvent('session.end', sessionId, { reason: 'completed' });
  }).catch((err: Error) => {
    const msg = `Error: ${err.message}`;
    appendOutput(sessionId, msg);
    emitReefEvent('output', sessionId, { text: msg });
    updateSession(sessionId, { status: 'error' });
    emitReefEvent('status', sessionId, { status: 'error', error: err.message });
  });

  return { sessionId, backend: provider, row };
}

async function spawnSdkAgent(sessionId: string, opts: SpawnOptions, now: string): Promise<SpawnResult> {
  try {
    const model = opts.model 
      ? getModel('anthropic', opts.model) 
      : getModel('anthropic', 'claude-sonnet-4-20250514');

    const { session } = await createAgentSession({
      cwd: opts.workdir || process.cwd(),
      model,
      sessionManager: SessionManager.inMemory(),
    });

    const row: SessionRow = {
      id: sessionId,
      task: opts.task,
      status: 'running',
      backend: 'sdk',
      model: model.id,
      created_at: now,
      updated_at: now,
      output: [],
    };
    insertSession(row);
    emitReefEvent('session.new', sessionId, { task: opts.task, backend: 'sdk', model: model.id });

    // Subscribe to events
    const unsubscribe = session.subscribe((event: any) => {
      handleSdkEvent(sessionId, event);
    });

    const abortController = new AbortController();
    runningSessions.set(sessionId, { session, unsubscribe, abortController });

    // Run the prompt asynchronously
    session.prompt(opts.task).then(() => {
      updateSession(sessionId, { status: 'completed' });
      emitReefEvent('status', sessionId, { status: 'completed' });
      emitReefEvent('session.end', sessionId, { reason: 'completed' });
      runningSessions.delete(sessionId);
    }).catch((err: Error) => {
      const msg = `Error: ${err.message}`;
      appendOutput(sessionId, msg);
      emitReefEvent('output', sessionId, { text: msg });
      updateSession(sessionId, { status: 'error' });
      emitReefEvent('status', sessionId, { status: 'error', error: err.message });
      runningSessions.delete(sessionId);
    });

    return { sessionId, backend: 'sdk', row };
  } catch (err) {
    console.warn(`SDK spawn failed for ${sessionId}, falling back to tmux:`, (err as Error).message);
    return spawnTmuxFallback(sessionId, opts, now);
  }
}

function spawnTmuxFallback(sessionId: string, opts: SpawnOptions, now: string): SpawnResult {
  const tmux = spawnTmuxAgent(opts.task, opts.workdir);
  const row: SessionRow = {
    id: sessionId,
    task: opts.task,
    status: 'running',
    backend: 'tmux',
    tmux_session: tmux.tmuxSession,
    created_at: now,
    updated_at: now,
    output: [],
  };
  insertSession(row);
  emitReefEvent('session.new', sessionId, { task: opts.task, backend: 'tmux' });
  return { sessionId, backend: 'tmux', row };
}

function handleSdkEvent(sessionId: string, event: any): void {
  switch (event.type) {
    case 'message_update': {
      // Stream assistant text
      const msg = event.assistantMessageEvent;
      if (msg?.type === 'content' && msg.content?.type === 'text') {
        const text = msg.content.text || '';
        if (text) {
          appendOutput(sessionId, text);
          emitReefEvent('output', sessionId, { text, streaming: true });
        }
      }
      break;
    }
    case 'message_end': {
      const message = event.message;
      if (message?.role === 'assistant') {
        // Full message complete
        const content = Array.isArray(message.content) 
          ? message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
          : String(message.content || '');
        if (content) {
          emitReefEvent('output', sessionId, { text: content, complete: true });
        }
      }
      break;
    }
    case 'tool_execution_start':
      emitReefEvent('tool.start', sessionId, { 
        toolName: event.toolName, 
        toolCallId: event.toolCallId,
        args: event.args 
      });
      appendOutput(sessionId, `⚡ ${event.toolName}(${summarizeArgs(event.args)})`);
      break;
    case 'tool_execution_end':
      emitReefEvent('tool.end', sessionId, { 
        toolName: event.toolName, 
        toolCallId: event.toolCallId,
        isError: event.isError 
      });
      break;
    case 'turn_start':
      emitReefEvent('output', sessionId, { text: '--- turn ---', meta: true });
      break;
  }
}

function summarizeArgs(args: any): string {
  if (!args) return '';
  if (typeof args === 'string') return args.slice(0, 80);
  if (args.command) return args.command.slice(0, 80);
  if (args.file_path) return args.file_path;
  if (args.path) return args.path;
  return JSON.stringify(args).slice(0, 80);
}

/**
 * Send a message to a running SDK session
 */
export async function sendMessage(sessionId: string, message: string): Promise<boolean> {
  const running = runningSessions.get(sessionId);
  if (!running) return false;
  
  try {
    await running.session.prompt(message);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a running session (SDK or tmux)
 */
export function kill(sessionId: string, row: SessionRow): void {
  // SDK session
  const running = runningSessions.get(sessionId);
  if (running) {
    running.session.agent?.abort();
    running.unsubscribe();
    runningSessions.delete(sessionId);
  }

  // Tmux session
  if (row.tmux_session) {
    killTmuxSession(row.tmux_session);
  }

  emitReefEvent('session.end', sessionId, { reason: 'killed' });
}

/**
 * Get output for a session
 */
export function getOutput(sessionId: string, row: SessionRow): string {
  // SDK sessions store output in DB
  if (row.backend === 'sdk') {
    return row.output.join('\n');
  }
  // Tmux sessions capture from pane
  if (row.tmux_session) {
    return captureOutput(row.tmux_session);
  }
  return '';
}

/**
 * Check if a session is still alive
 */
export function isAlive(sessionId: string, row: SessionRow): boolean {
  if (row.backend === 'sdk') {
    return runningSessions.has(sessionId);
  }
  if (row.tmux_session) {
    return sessionExists(row.tmux_session);
  }
  return false;
}

/**
 * Get stats about running sessions
 */
export function getStats(): { sdk: number; tmux: number; total: number } {
  return {
    sdk: runningSessions.size,
    tmux: 0, // Could count tmux sessions if needed
    total: runningSessions.size,
  };
}
