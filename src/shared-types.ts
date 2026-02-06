/**
 * reef-core/shared-types.ts — Source of truth for all shared types
 */

// ─── Enums / Unions ───

export type SessionStatus = 'running' | 'completed' | 'error' | 'stopped'
export type Provider = 'anthropic' | 'openai' | 'google'
export type Backend = 'sdk' | 'tmux' | 'openai' | 'google'

// ─── Session ───

export interface SessionRow {
  id: string
  task: string
  status: SessionStatus
  backend: Backend
  provider?: Provider
  model?: string
  tmux_session?: string
  created_at: string
  updated_at: string
}

// ─── Events (discriminated union) ───

export interface SessionNewEvent {
  type: 'session.new'
  sessionId: string
  data: { task: string; backend: Backend; provider?: Provider; model?: string }
  timestamp: string
}

export interface SessionEndEvent {
  type: 'session.end'
  sessionId: string
  data: { reason: string }
  timestamp: string
}

export interface OutputEvent {
  type: 'output'
  sessionId: string
  data: { text: string; streaming?: boolean; complete?: boolean; meta?: boolean }
  timestamp: string
}

export interface StatusEvent {
  type: 'status'
  sessionId: string
  data: { status: SessionStatus; error?: string }
  timestamp: string
}

export interface ToolStartEvent {
  type: 'tool.start'
  sessionId: string
  data: { toolName: string; toolCallId: string; args?: unknown }
  timestamp: string
}

export interface ToolEndEvent {
  type: 'tool.end'
  sessionId: string
  data: { toolName: string; toolCallId: string; isError?: boolean }
  timestamp: string
}

export type ReefEvent =
  | SessionNewEvent
  | SessionEndEvent
  | OutputEvent
  | StatusEvent
  | ToolStartEvent
  | ToolEndEvent

export type ReefEventType = ReefEvent['type']

// ─── API Request / Response ───

export interface SpawnRequest {
  task: string
  workdir?: string
  model?: string
  backend?: Backend
  provider?: Provider
}

export interface SpawnResponse {
  session: SessionRow
  backend: Backend
}

export interface StatusResponse {
  ok: boolean
  version: string
  sessions: number
  running: Record<string, unknown>
  wsClients: number
  uptime: number
  providers: { anthropic: boolean; openai: boolean; google: boolean }
}

export interface SessionListResponse {
  sessions: SessionRow[]
}

export interface SessionDetailResponse {
  session: SessionRow
  alive: boolean
}

export interface SessionOutputResponse {
  id: string
  output: string
}

export interface ErrorResponse {
  error: string
}

// ─── User Management ───

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  active: boolean
  created_at: string
  updated_at: string
  last_login?: string
}

export interface CreateUserRequest {
  email: string
  name: string
  password: string
  role?: 'admin' | 'user'
}

export interface UpdateUserRequest {
  email?: string
  name?: string
  password?: string
  role?: 'admin' | 'user'
  active?: boolean
}

export interface LoginRequest {
  email: string
  password: string
}

export interface UserResponse {
  user: User
}

export interface UsersListResponse {
  users: User[]
  total: number
  page: number
  limit: number
}

export interface LoginResponse {
  user: User
  token: string
}

// ─── WebSocket Messages ───

export type WsClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'subscribe_all' }
  | { type: 'send'; sessionId: string; message: string }

export type WsServerMessage =
  | ReefEvent
  | { type: 'connected'; data: { message: string } }
  | { type: 'subscribed'; sessionId: string }
  | { type: 'unsubscribed'; sessionId: string }
  | { type: 'sent'; sessionId: string; data: string }
  | { type: 'error'; data: string }

export type WsMessage = WsClientMessage | WsServerMessage
