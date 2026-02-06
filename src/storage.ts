/**
 * reef-core/storage.ts — SQLite-backed session and user store (better-sqlite3)
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { SessionRow } from './db.js'
import type { User, CreateUserRequest, UpdateUserRequest } from './shared-types.js'

export interface SessionStore {
  insert(session: SessionRow): void
  get(id: string): SessionRow | undefined
  getAll(): SessionRow[]
  update(id: string, updates: Partial<SessionRow>): void
  appendOutput(id: string, line: string): void
  getOutput(id: string): string[]
  delete(id: string): void
}

export interface UserStore {
  insert(user: CreateUserRequest): User
  get(id: string): User | undefined
  getByEmail(email: string): User | undefined
  getAll(page?: number, limit?: number): { users: User[]; total: number }
  update(id: string, updates: UpdateUserRequest): User | undefined
  delete(id: string): boolean
  verifyPassword(email: string, password: string): User | undefined
  updateLastLogin(id: string): void
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

interface UserDbRow {
  id: string
  email: string
  name: string
  password_hash: string
  role: string
  active: number
  created_at: string
  updated_at: string
  last_login: string | null
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
      
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
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

export class SqliteUserStore implements UserStore {
  private db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    // Note: Migration is handled by SqliteSessionStore
  }

  private hashPassword(password: string): string {
    return crypto.pbkdf2Sync(password, 'reef-salt', 10000, 64, 'sha256').toString('hex')
  }

  private verifyPasswordHash(password: string, hash: string): boolean {
    const hashedInput = this.hashPassword(password)
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashedInput, 'hex'))
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private hydrateUser(row: UserDbRow): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as 'admin' | 'user',
      active: row.active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login: row.last_login ?? undefined,
    }
  }

  insert(userData: CreateUserRequest): User {
    const id = this.generateId()
    const now = new Date().toISOString()
    const passwordHash = this.hashPassword(userData.password)

    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES (@id, @email, @name, @password_hash, @role, @active, @created_at, @updated_at)
    `)

    stmt.run({
      id,
      email: userData.email,
      name: userData.name,
      password_hash: passwordHash,
      role: userData.role || 'user',
      active: 1,
      created_at: now,
      updated_at: now,
    })

    return this.get(id)!
  }

  get(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserDbRow | undefined
    return row ? this.hydrateUser(row) : undefined
  }

  getByEmail(email: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | UserDbRow
      | undefined
    return row ? this.hydrateUser(row) : undefined
  }

  getAll(page = 1, limit = 50): { users: User[]; total: number } {
    const total = (
      this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
    ).count
    const offset = (page - 1) * limit

    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as UserDbRow[]

    return {
      users: rows.map((r) => this.hydrateUser(r)),
      total,
    }
  }

  update(id: string, updates: UpdateUserRequest): User | undefined {
    const user = this.get(id)
    if (!user) return undefined

    const allowed = ['email', 'name', 'role', 'active'] as const
    const sets: string[] = ['updated_at = @updated_at']
    const params: Record<string, unknown> = {
      id,
      updated_at: new Date().toISOString(),
    }

    for (const key of allowed) {
      if (key in updates && updates[key] !== undefined) {
        sets.push(`${key} = @${key}`)
        params[key] = key === 'active' ? (updates[key] ? 1 : 0) : updates[key]
      }
    }

    if (updates.password) {
      sets.push('password_hash = @password_hash')
      params.password_hash = this.hashPassword(updates.password)
    }

    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params)
    return this.get(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return result.changes > 0
  }

  verifyPassword(email: string, password: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email) as
      | UserDbRow
      | undefined
    if (!row || !this.verifyPasswordHash(password, row.password_hash)) {
      return undefined
    }
    return this.hydrateUser(row)
  }

  updateLastLogin(id: string): void {
    this.db
      .prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id)
  }

  close(): void {
    this.db.close()
  }
}
