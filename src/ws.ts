/**
 * reef-core/ws.ts — WebSocket server for real-time event streaming
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { eventBus, type ReefEvent } from './events.js';
import { getSession } from './db.js';
import { sendMessage } from './agent.js';

interface ClientState {
  subscriptions: Set<string>;  // sessionIds, empty = all
}

const clients = new Map<WebSocket, ClientState>();

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const state: ClientState = { subscriptions: new Set() };
    clients.set(ws, state);
    console.log(`🔌 WebSocket client connected (${clients.size} total)`);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, state, msg);
      } catch {
        ws.send(JSON.stringify({ type: 'error', data: 'invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`🔌 WebSocket client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'connected', data: { message: 'reef-core ws v0.2.0' } }));
  });

  // Broadcast reef events to subscribed clients
  eventBus.on('reef', (event: ReefEvent) => {
    const payload = JSON.stringify(event);
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Send if client has no subscriptions (= all) or is subscribed to this session
      if (state.subscriptions.size === 0 || state.subscriptions.has(event.sessionId)) {
        ws.send(payload);
      }
    }
  });

  console.log('🔌 WebSocket server attached at /ws');
  return wss;
}

function handleClientMessage(ws: WebSocket, state: ClientState, msg: any): void {
  switch (msg.type) {
    case 'subscribe':
      if (msg.sessionId) {
        state.subscriptions.add(msg.sessionId);
        ws.send(JSON.stringify({ type: 'subscribed', sessionId: msg.sessionId }));
      }
      break;

    case 'unsubscribe':
      if (msg.sessionId) {
        state.subscriptions.delete(msg.sessionId);
        ws.send(JSON.stringify({ type: 'unsubscribed', sessionId: msg.sessionId }));
      }
      break;

    case 'subscribe_all':
      state.subscriptions.clear();
      ws.send(JSON.stringify({ type: 'subscribed', sessionId: '*' }));
      break;

    case 'send':
      if (msg.sessionId && msg.message) {
        const session = getSession(msg.sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', data: 'session not found' }));
          return;
        }
        sendMessage(msg.sessionId, msg.message).then(ok => {
          ws.send(JSON.stringify({ type: ok ? 'sent' : 'error', sessionId: msg.sessionId, data: ok ? 'sent' : 'send failed' }));
        });
      }
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', data: `unknown message type: ${msg.type}` }));
  }
}

export function getWsStats(): { clients: number } {
  return { clients: clients.size };
}
