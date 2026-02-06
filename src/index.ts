/**
 * reef-core — Agent runtime with Pi SDK + WebSocket
 * 
 * Spawns coding agents via Pi SDK (or tmux fallback),
 * exposes HTTP REST + WebSocket API on port 7777.
 */
import { initDatabase } from './db.js';
import { startServer } from './api.js';

console.log('🦖 reef-core v0.2.0 starting...');
initDatabase();
console.log('📦 Database initialized');
startServer();
