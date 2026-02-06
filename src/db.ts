/**
 * reef-core/db.ts — JSON file state (zero native deps)
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.REEF_DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'sessions.json');

export interface SessionRow {
  id: string;
  task: string;
  status: 'running' | 'stopped' | 'error' | 'completed';
  backend: 'sdk' | 'tmux' | 'openai' | 'google';
  provider?: 'anthropic' | 'openai' | 'google';
  tmux_session?: string;
  model?: string;
  created_at: string;
  updated_at: string;
  output: string[];  // accumulated output lines
}

interface Store {
  sessions: SessionRow[];
}

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return { sessions: [] };
  }
}

function save(store: Store): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

export function initDatabase(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) save({ sessions: [] });
}

export function insertSession(s: SessionRow): void {
  const store = load();
  store.sessions.push(s);
  save(store);
}

export function getSession(id: string): SessionRow | undefined {
  return load().sessions.find(s => s.id === id);
}

export function getAllSessions(): SessionRow[] {
  return load().sessions;
}

export function updateSession(id: string, updates: Partial<SessionRow>): void {
  const store = load();
  const s = store.sessions.find(s => s.id === id);
  if (s) {
    Object.assign(s, updates, { updated_at: new Date().toISOString() });
  }
  save(store);
}

export function appendOutput(id: string, line: string): void {
  const store = load();
  const s = store.sessions.find(s => s.id === id);
  if (s) {
    s.output.push(line);
    s.updated_at = new Date().toISOString();
  }
  save(store);
}

export function deleteSession(id: string): void {
  const store = load();
  store.sessions = store.sessions.filter(s => s.id !== id);
  save(store);
}
