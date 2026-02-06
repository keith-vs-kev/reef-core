/**
 * reef-core — Agent runtime with Pi SDK + WebSocket
 *
 * Spawns coding agents via Pi SDK (or tmux fallback),
 * exposes HTTP REST + WebSocket API on port 7777.
 */
import { initDatabase, closeDatabase } from './db.js'
import { initializeDefaultAdmin, closeUserDatabase } from './user-db.js'
import { startServer } from './api.js'

export * from './shared-types.js'

console.log('🦖 reef-core v0.3.0 starting...')
initDatabase()
console.log('📦 Database initialized')
initializeDefaultAdmin()
const server = startServer()

function shutdown(signal: string): void {
  console.log(`\n🛑 ${signal} received, shutting down...`)
  server.close(() => {
    console.log('🔌 HTTP server closed')
  })
  closeDatabase()
  closeUserDatabase()
  console.log('📦 Database closed')
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
