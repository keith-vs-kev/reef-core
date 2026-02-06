/**
 * reef-core/tmux.ts — Spawn & manage Claude Code in tmux sessions
 */
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLAUDE_BIN = process.env.REEF_CLAUDE_BIN || 'claude';

export interface SpawnResult {
  sessionId: string;
  tmuxSession: string;
}

function uid(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Spawn a new Claude Code instance in a tmux session with a task */
export function spawnAgent(task: string, workdir?: string): SpawnResult {
  const id = uid();
  const tmuxSession = `reef-${id}`;
  const wd = workdir || process.cwd();

  // Write task to a temp file to avoid shell escaping hell
  const tmpFile = path.join(os.tmpdir(), `reef-task-${id}.txt`);
  fs.writeFileSync(tmpFile, task);

  // Create tmux session and run claude --print with task from file
  execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(wd)}`);
  execSync(`tmux send-keys -t ${tmuxSession} "${CLAUDE_BIN} --print < ${tmpFile}" Enter`);

  return { sessionId: id, tmuxSession };
}

/** Spawn claude in interactive mode */
export function spawnInteractiveAgent(workdir?: string): SpawnResult {
  const id = uid();
  const tmuxSession = `reef-${id}`;
  const wd = workdir || process.cwd();

  execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(wd)}`);
  execSync(`tmux send-keys -t ${tmuxSession} "${CLAUDE_BIN}" Enter`);

  return { sessionId: id, tmuxSession };
}

/** Send a message to a running tmux/claude session */
export function sendToSession(tmuxSession: string, message: string): void {
  const tmpFile = path.join(os.tmpdir(), `reef-msg-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, message);
  // Use buffer-based send to avoid escaping issues
  execSync(`tmux load-buffer ${tmpFile} \\; paste-buffer -t ${tmuxSession} \\; send-keys -t ${tmuxSession} Enter`);
  fs.unlinkSync(tmpFile);
}

/** Capture output from a tmux session */
export function captureOutput(tmuxSession: string, lines = 500): string {
  try {
    return execSync(`tmux capture-pane -t ${tmuxSession} -p -S -${lines}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/** Check if a tmux session exists */
export function sessionExists(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export function killSession(tmuxSession: string): void {
  try {
    execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`);
  } catch { /* already dead */ }
}

/** List all reef- tmux sessions */
export function listTmuxSessions(): string[] {
  try {
    const out = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true", {
      encoding: 'utf-8',
    });
    return out.trim().split('\n').filter(s => s.startsWith('reef-'));
  } catch {
    return [];
  }
}
