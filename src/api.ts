/**
 * reef-core/api.ts — HTTP API server
 */
import http from 'http'
import { getAllSessions, getSession, updateSession } from './db.js'
import { spawn, kill, getOutput, isAlive, sendMessage, getStats } from './agent.js'
import { attachWebSocket, getWsStats } from './ws.js'
import {
  createUser,
  getUser,
  getUserByEmail,
  getAllUsers,
  updateUser,
  deleteUser,
  verifyUserPassword,
  updateUserLastLogin,
} from './user-db.js'
import { generateToken, verifyToken, extractTokenFromHeader } from './auth.js'
import type {
  SpawnRequest,
  StatusResponse,
  SessionListResponse,
  SessionDetailResponse,
  SessionOutputResponse,
  SpawnResponse,
  ErrorResponse,
  CreateUserRequest,
  UpdateUserRequest,
  LoginRequest,
  UserResponse,
  UsersListResponse,
  LoginResponse,
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

function authenticate(req: http.IncomingMessage): { userId: string; role: string } | null {
  const token = extractTokenFromHeader(req.headers.authorization)
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  return { userId: payload.userId, role: payload.role }
}

function requireAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): { userId: string; role: string } | null {
  const auth = authenticate(req)
  if (!auth) {
    json(res, { error: 'Authentication required' } as ErrorResponse, 401)
    return null
  }
  return auth
}

function requireAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): { userId: string; role: string } | null {
  const auth = requireAuth(req, res)
  if (!auth) return null

  if (auth.role !== 'admin') {
    json(res, { error: 'Admin access required' } as ErrorResponse, 403)
    return null
  }
  return auth
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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

      // ━━━ User Management Endpoints ━━━

      // POST /auth/login
      if (path === '/auth/login' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as LoginRequest
        const { email, password } = body

        if (!email || !password) {
          return json(res, { error: 'Email and password are required' } as ErrorResponse, 400)
        }

        const user = verifyUserPassword(email, password)
        if (!user) {
          return json(res, { error: 'Invalid credentials' } as ErrorResponse, 401)
        }

        updateUserLastLogin(user.id)
        const token = generateToken(user)
        const response: LoginResponse = { user, token }
        return json(res, response)
      }

      // POST /users (Create user) - Admin only
      if (path === '/users' && req.method === 'POST') {
        const auth = requireAdmin(req, res)
        if (!auth) return

        const body = JSON.parse(await readBody(req)) as CreateUserRequest
        const { email, name, password, role } = body

        if (!email || !name || !password) {
          return json(
            res,
            { error: 'Email, name, and password are required' } as ErrorResponse,
            400
          )
        }

        // Check if user already exists
        const existingUser = getUserByEmail(email)
        if (existingUser) {
          return json(res, { error: 'User with this email already exists' } as ErrorResponse, 409)
        }

        const user = createUser({ email, name, password, role })
        const response: UserResponse = { user }
        return json(res, response, 201)
      }

      // GET /users (List users) - Admin only
      if (path === '/users' && req.method === 'GET') {
        const auth = requireAdmin(req, res)
        if (!auth) return

        const url = new URL(req.url || '/', `http://localhost:${PORT}`)
        const page = parseInt(url.searchParams.get('page') || '1', 10)
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)

        const result = getAllUsers(page, limit)
        const response: UsersListResponse = {
          users: result.users,
          total: result.total,
          page,
          limit,
        }
        return json(res, response)
      }

      // GET /users/me (Get current user)
      if (path === '/users/me' && req.method === 'GET') {
        const auth = requireAuth(req, res)
        if (!auth) return

        const user = getUser(auth.userId)
        if (!user) {
          return json(res, { error: 'User not found' } as ErrorResponse, 404)
        }

        const response: UserResponse = { user }
        return json(res, response)
      }

      // GET /users/:id (Get user by ID) - Admin only
      const getUserMatch = path.match(/^\/users\/([^/]+)$/)
      if (getUserMatch && req.method === 'GET') {
        const auth = requireAdmin(req, res)
        if (!auth) return

        const user = getUser(getUserMatch[1])
        if (!user) {
          return json(res, { error: 'User not found' } as ErrorResponse, 404)
        }

        const response: UserResponse = { user }
        return json(res, response)
      }

      // PUT /users/:id (Update user) - Admin only, or user updating themselves
      const updateUserMatch = path.match(/^\/users\/([^/]+)$/)
      if (updateUserMatch && req.method === 'PUT') {
        const auth = requireAuth(req, res)
        if (!auth) return

        const targetUserId = updateUserMatch[1]

        // Allow users to update themselves, or admin to update anyone
        if (auth.role !== 'admin' && auth.userId !== targetUserId) {
          return json(res, { error: 'Forbidden' } as ErrorResponse, 403)
        }

        const body = JSON.parse(await readBody(req)) as UpdateUserRequest

        // Non-admin users can only update certain fields
        if (auth.role !== 'admin') {
          const allowedFields = ['name', 'password']
          const submittedFields = Object.keys(body)
          const invalidFields = submittedFields.filter((field) => !allowedFields.includes(field))

          if (invalidFields.length > 0) {
            return json(
              res,
              {
                error: `Non-admin users can only update: ${allowedFields.join(', ')}`,
              } as ErrorResponse,
              403
            )
          }
        }

        const user = updateUser(targetUserId, body)
        if (!user) {
          return json(res, { error: 'User not found' } as ErrorResponse, 404)
        }

        const response: UserResponse = { user }
        return json(res, response)
      }

      // DELETE /users/:id (Delete user) - Admin only
      const deleteUserMatch = path.match(/^\/users\/([^/]+)$/)
      if (deleteUserMatch && req.method === 'DELETE') {
        const auth = requireAdmin(req, res)
        if (!auth) return

        const targetUserId = deleteUserMatch[1]

        // Prevent admin from deleting themselves
        if (auth.userId === targetUserId) {
          return json(res, { error: 'Cannot delete your own account' } as ErrorResponse, 400)
        }

        const success = deleteUser(targetUserId)
        if (!success) {
          return json(res, { error: 'User not found' } as ErrorResponse, 404)
        }

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
