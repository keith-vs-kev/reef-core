/**
 * reef-core/ws.ts — WebSocket server for real-time event streaming
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { eventBus, type ReefEvent } from './events.js'
import { getSession } from './db.js'
import { sendMessage } from './agent.js'
import type { WsClientMessage, WsServerMessage } from './shared-types.js'

interface ClientState {
  subscriptions: Set<string> // sessionIds, empty = all
}

const clients = new Map<WebSocket, ClientState>()

function sendWs(ws: WebSocket, msg: WsServerMessage): void {
  ws.send(JSON.stringify(msg))
}

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    const state: ClientState = { subscriptions: new Set() }
    clients.set(ws, state)
    console.log(`🔌 WebSocket client connected (${clients.size} total)`)

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage
        handleClientMessage(ws, state, msg)
      } catch {
        sendWs(ws, { type: 'error', data: 'invalid JSON' })
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      console.log(`🔌 WebSocket client disconnected (${clients.size} total)`)
    })

    ws.on('error', () => {
      clients.delete(ws)
    })

    // Send welcome
    sendWs(ws, { type: 'connected', data: { message: 'reef-core ws v0.2.0' } })
  })

  // Broadcast reef events to subscribed clients
  eventBus.onReef((event: ReefEvent) => {
    const payload = JSON.stringify(event)
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      if (state.subscriptions.size === 0 || state.subscriptions.has(event.sessionId)) {
        ws.send(payload)
      }
    }
  })

  console.log('🔌 WebSocket server attached at /ws')
  return wss
}

function handleClientMessage(ws: WebSocket, state: ClientState, msg: WsClientMessage): void {
  switch (msg.type) {
    case 'subscribe':
      state.subscriptions.add(msg.sessionId)
      sendWs(ws, { type: 'subscribed', sessionId: msg.sessionId })
      break

    case 'unsubscribe':
      state.subscriptions.delete(msg.sessionId)
      sendWs(ws, { type: 'unsubscribed', sessionId: msg.sessionId })
      break

    case 'subscribe_all':
      state.subscriptions.clear()
      sendWs(ws, { type: 'subscribed', sessionId: '*' })
      break

    case 'send':
      if (msg.sessionId && msg.message) {
        const session = getSession(msg.sessionId)
        if (!session) {
          sendWs(ws, { type: 'error', data: 'session not found' })
          return
        }
        sendMessage(msg.sessionId, msg.message).then((ok) => {
          sendWs(ws, {
            type: ok ? 'sent' : 'error',
            sessionId: msg.sessionId,
            data: ok ? 'sent' : 'send failed',
          } as WsServerMessage)
        })
      }
      break

    default:
      sendWs(ws, {
        type: 'error',
        data: `unknown message type: ${(msg as Record<string, unknown>).type}`,
      })
  }
}

export function getWsStats(): { clients: number } {
  return { clients: clients.size }
}
