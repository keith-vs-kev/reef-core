/**
 * reef-core/user-db.ts — User management database operations
 */
import path from 'path'
import { SqliteUserStore } from './storage.js'
import type { User, CreateUserRequest, UpdateUserRequest } from './shared-types.js'

const DATA_DIR = process.env.REEF_DATA_DIR || path.join(process.cwd(), 'data')
const DB_PATH = process.env.REEF_DB_PATH || path.join(DATA_DIR, 'reef.db')

const store = new SqliteUserStore(DB_PATH)

export function createUser(userData: CreateUserRequest): User {
  return store.insert(userData)
}

export function getUser(id: string): User | undefined {
  return store.get(id)
}

export function getUserByEmail(email: string): User | undefined {
  return store.getByEmail(email)
}

export function getAllUsers(page = 1, limit = 50): { users: User[]; total: number } {
  return store.getAll(page, limit)
}

export function updateUser(id: string, updates: UpdateUserRequest): User | undefined {
  return store.update(id, updates)
}

export function deleteUser(id: string): boolean {
  return store.delete(id)
}

export function verifyUserPassword(email: string, password: string): User | undefined {
  return store.verifyPassword(email, password)
}

export function updateUserLastLogin(id: string): void {
  store.updateLastLogin(id)
}

export function closeUserDatabase(): void {
  store.close()
}

export function initializeDefaultAdmin(): void {
  try {
    // Check if any admin users exist
    const { users, total } = getAllUsers(1, 1)
    const hasAdmin = users.some((user) => user.role === 'admin')

    if (!hasAdmin && total === 0) {
      // Create default admin user
      const defaultAdmin = {
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@reef.local',
        name: 'Default Admin',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
        role: 'admin' as const,
      }

      const admin = createUser(defaultAdmin)
      console.log(`👤 Created default admin user: ${admin.email}`)

      if (!process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log(
          '⚠️  Warning: Using default password "admin123". Set DEFAULT_ADMIN_PASSWORD environment variable for security.'
        )
      }
    }
  } catch (error) {
    console.error('❌ Failed to initialize default admin:', error)
  }
}
