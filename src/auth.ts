/**
 * reef-core/auth.ts — Simple JWT authentication
 */
import crypto from 'crypto'
import type { User } from './shared-types.js'

const JWT_SECRET = process.env.JWT_SECRET || 'reef-default-secret-change-in-production'

interface JWTPayload {
  userId: string
  email: string
  role: string
  iat: number
  exp: number
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function base64UrlDecode(str: string): string {
  // Add padding if needed
  str += '='.repeat((4 - (str.length % 4)) % 4)
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
}

export function generateToken(user: User): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const [encodedHeader, encodedPayload, signature] = token.split('.')

    if (!encodedHeader || !encodedPayload || !signature) {
      return null
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    if (signature !== expectedSignature) {
      return null
    }

    const payload: JWTPayload = JSON.parse(base64UrlDecode(encodedPayload))

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export function extractTokenFromHeader(authorization?: string): string | null {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null
  }
  return authorization.substring(7)
}
