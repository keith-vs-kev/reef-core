/**
 * reef-core/api.ts — HTTP API server
 */
import http from 'http'
import { getAllSessions, getSession, updateSession } from './db.js'
import { spawn, kill, getOutput, isAlive, sendMessage, getStats } from './agent.js'
import { attachWebSocket, getWsStats } from './ws.js'
import type {
  SpawnRequest,
  StatusResponse,
  SessionListResponse,
  SessionDetailResponse,
  SessionOutputResponse,
  SpawnResponse,
  ErrorResponse,
} from './shared-types.js'

const PORT = parseInt(process.env.REEF_PORT || '7777', 10)

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`)
    const path = url.pathname

    try {
      // GET /status
      if (path === '/status' && req.method === 'GET') {
        const agentStats = getStats()
        const wsStats = getWsStats()
        const providers = {
          anthropic: !!process.env.ANTHROPIC_API_KEY,
          openai: !!process.env.OPENAI_API_KEY,
          google: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
        }
        const response: StatusResponse = {
          ok: true,
          version: '0.3.0',
          sessions: getAllSessions().length,
          running: agentStats,
          wsClients: wsStats.clients,
          uptime: process.uptime(),
          providers,
        }
        return json(res, response)
      }

      // GET /sessions
      if (path === '/sessions' && req.method === 'GET') {
        const sessions = getAllSessions()
        // Reconcile running status
        for (const s of sessions) {
          if (s.status === 'running' && !isAlive(s.id, s)) {
            updateSession(s.id, { status: 'stopped' })
            s.status = 'stopped'
          }
        }
        const response: SessionListResponse = { sessions }
        return json(res, response)
      }

      // POST /sessions — spawn agent
      if (path === '/sessions' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as SpawnRequest
        const { task, workdir, model, backend, provider } = body

        if (!task) {
          const err: ErrorResponse = { error: 'task is required' }
          return json(res, err, 400)
        }

        const result = await spawn({
          task,
          workdir,
          model,
          provider,
          forceBackend: backend as 'sdk' | 'tmux' | undefined,
        })
        const response: SpawnResponse = { session: result.row, backend: result.backend }
        return json(res, response, 201)
      }

      // GET /sessions/:id
      const getMatch = path.match(/^\/sessions\/([^/]+)$/)
      if (getMatch && req.method === 'GET') {
        const session = getSession(getMatch[1])
        if (!session) return json(res, { error: 'not found' } as ErrorResponse, 404)
        const response: SessionDetailResponse = { session, alive: isAlive(session.id, session) }
        return json(res, response)
      }

      // GET /sessions/:id/output
      const outputMatch = path.match(/^\/sessions\/([^/]+)\/output$/)
      if (outputMatch && req.method === 'GET') {
        const session = getSession(outputMatch[1])
        if (!session) return json(res, { error: 'not found' } as ErrorResponse, 404)
        const output = getOutput(session.id, session)
        const response: SessionOutputResponse = { id: session.id, output }
        return json(res, response)
      }

      // POST /sessions/:id/send
      const sendMatch = path.match(/^\/sessions\/([^/]+)\/send$/)
      if (sendMatch && req.method === 'POST') {
        const session = getSession(sendMatch[1])
        if (!session) return json(res, { error: 'not found' }, 404)
        const body = JSON.parse(await readBody(req))
        const ok = await sendMessage(session.id, body.message || '')
        return json(res, { ok })
      }

      // DELETE /sessions/:id
      const deleteMatch = path.match(/^\/sessions\/([^/]+)$/)
      if (deleteMatch && req.method === 'DELETE') {
        const session = getSession(deleteMatch[1])
        if (!session) return json(res, { error: 'not found' }, 404)
        kill(session.id, session)
        updateSession(session.id, { status: 'stopped' })
        return json(res, { ok: true })
      }

      json(res, { error: 'not found' }, 404)
    } catch (err) {
      console.error('API error:', err)
      json(res, { error: String(err) }, 500)
    }
  })

  // Attach WebSocket
  attachWebSocket(server)

  server.listen(PORT, () => {
    console.log(`🦖 reef-core v0.3.0 listening on http://localhost:${PORT}`)
    console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`)
  })

  return server
}
