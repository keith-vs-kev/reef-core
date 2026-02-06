/**
 * reef-core/storage.ts — SQLite-backed session store (better-sqlite3)
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import type { SessionRow } from './db.js'

export interface SessionStore {
  insert(session: SessionRow): void
  get(id: string): SessionRow | undefined
  getAll(): SessionRow[]
  update(id: string, updates: Partial<SessionRow>): void
  appendOutput(id: string, line: string): void
  getOutput(id: string): string[]
  delete(id: string): void
}

interface SessionDbRow {
  id: string
  task: string
  status: string
  backend: string
  provider: string | null
  model: string | null
  tmux_session: string | null
  created_at: string
  updated_at: string
}

export class SqliteSessionStore implements SessionStore {
  private db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        backend TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        tmux_session TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS output_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_output_session ON output_lines(session_id);
    `)
  }

  insert(session: SessionRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, task, status, backend, provider, model, tmux_session, created_at, updated_at)
      VALUES (@id, @task, @status, @backend, @provider, @model, @tmux_session, @created_at, @updated_at)
    `)
    stmt.run({
      id: session.id,
      task: session.task,
      status: session.status,
      backend: session.backend,
      provider: session.provider ?? null,
      model: session.model ?? null,
      tmux_session: session.tmux_session ?? null,
      created_at: session.created_at,
      updated_at: session.updated_at,
    })

    if (session.output.length > 0) {
      const insertLine = this.db.prepare(
        'INSERT INTO output_lines (session_id, content) VALUES (?, ?)'
      )
      const insertMany = this.db.transaction((lines: string[]) => {
        for (const line of lines) insertLine.run(session.id, line)
      })
      insertMany(session.output)
    }
  }

  get(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionDbRow
      | undefined
    if (!row) return undefined
    return this.hydrate(row)
  }

  getAll(): SessionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all() as SessionDbRow[]
    return rows.map((r) => this.hydrate(r))
  }

  update(id: string, updates: Partial<SessionRow>): void {
    const allowed = ['task', 'status', 'backend', 'provider', 'model', 'tmux_session'] as const
    const sets: string[] = ['updated_at = @updated_at']
    const params: Record<string, unknown> = {
      id,
      updated_at: new Date().toISOString(),
    }
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = @${key}`)
        params[key] = (updates as Record<string, unknown>)[key] ?? null
      }
    }
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = @id`).run(params)
  }

  appendOutput(id: string, line: string): void {
    this.db.prepare('INSERT INTO output_lines (session_id, content) VALUES (?, ?)').run(id, line)
    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  getOutput(id: string): string[] {
    const rows = this.db
      .prepare('SELECT content FROM output_lines WHERE session_id = ? ORDER BY id')
      .all(id) as { content: string }[]
    return rows.map((r) => r.content)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }

  private hydrate(row: SessionDbRow): SessionRow {
    return {
      id: row.id,
      task: row.task,
      status: row.status as SessionRow['status'],
      backend: row.backend as SessionRow['backend'],
      provider: (row.provider as SessionRow['provider']) ?? undefined,
      model: row.model ?? undefined,
      tmux_session: row.tmux_session ?? undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      output: this.getOutput(row.id),
    }
  }
}
