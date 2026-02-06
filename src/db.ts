/**
 * reef-core/db.ts — Session persistence (SQLite via better-sqlite3)
 *
 * Exports the same function signatures as the old JSON-file version
 * so agent.ts and api.ts don't need changes.
 */
import path from 'path'
import { SqliteSessionStore } from './storage.js'

const DATA_DIR = process.env.REEF_DATA_DIR || path.join(process.cwd(), 'data')
const DB_PATH = process.env.REEF_DB_PATH || path.join(DATA_DIR, 'reef.db')

import type { SessionRow as SharedSessionRow } from './shared-types.js'

export interface SessionRow extends SharedSessionRow {
  output: string[]
}

const store = new SqliteSessionStore(DB_PATH)

export function initDatabase(): void {
  // SQLite store self-initialises in constructor; this is now a no-op
  // kept for backwards compatibility
}

export function insertSession(s: SessionRow): void {
  store.insert(s)
}

export function getSession(id: string): SessionRow | undefined {
  return store.get(id)
}

export function getAllSessions(): SessionRow[] {
  return store.getAll()
}

export function updateSession(id: string, updates: Partial<SessionRow>): void {
  store.update(id, updates)
}

export function appendOutput(id: string, line: string): void {
  store.appendOutput(id, line)
}

export function deleteSession(id: string): void {
  store.delete(id)
}

export function closeDatabase(): void {
  store.close()
}
