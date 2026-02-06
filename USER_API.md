# User Management API

This document describes the user management REST API endpoints available in reef-core.

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. After logging in, include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Default Admin User

On first startup, a default admin user is created:

- Email: `admin@reef.local` (or `DEFAULT_ADMIN_EMAIL` env var)
- Password: `admin123` (or `DEFAULT_ADMIN_PASSWORD` env var)
- Role: `admin`

**Important:** Change the default password immediately in production!

## Endpoints

### Authentication

#### POST /auth/login

Login with email and password to receive a JWT token.

**Request:**

```json
{
  "email": "admin@reef.local",
  "password": "admin123"
}
```

**Response:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@reef.local",
    "name": "Default Admin",
    "role": "admin",
    "active": true,
    "created_at": "2026-02-06T09:36:44.000Z",
    "updated_at": "2026-02-06T09:36:44.000Z",
    "last_login": "2026-02-06T09:36:44.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### User Management

#### POST /users (Admin only)

Create a new user.

**Request:**

```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "password": "secure-password",
  "role": "user"
}
```

**Response:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "active": true,
    "created_at": "2026-02-06T09:36:44.000Z",
    "updated_at": "2026-02-06T09:36:44.000Z"
  }
}
```

#### GET /users (Admin only)

List all users with pagination.

**Query Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Users per page (default: 50)

**Response:**

```json
{
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "admin@reef.local",
      "name": "Default Admin",
      "role": "admin",
      "active": true,
      "created_at": "2026-02-06T09:36:44.000Z",
      "updated_at": "2026-02-06T09:36:44.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

#### GET /users/me

Get current user's profile (requires authentication).

**Response:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@reef.local",
    "name": "Default Admin",
    "role": "admin",
    "active": true,
    "created_at": "2026-02-06T09:36:44.000Z",
    "updated_at": "2026-02-06T09:36:44.000Z"
  }
}
```

#### GET /users/:id (Admin only)

Get a specific user by ID.

**Response:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@reef.local",
    "name": "Default Admin",
    "role": "admin",
    "active": true,
    "created_at": "2026-02-06T09:36:44.000Z",
    "updated_at": "2026-02-06T09:36:44.000Z"
  }
}
```

#### PUT /users/:id

Update a user. Admin can update any user, regular users can only update themselves.

**Non-admin users can only update:** `name`, `password`
**Admin users can update:** `email`, `name`, `password`, `role`, `active`

**Request:**

```json
{
  "name": "Updated Name",
  "password": "new-password"
}
```

**Response:**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "admin@reef.local",
    "name": "Updated Name",
    "role": "admin",
    "active": true,
    "created_at": "2026-02-06T09:36:44.000Z",
    "updated_at": "2026-02-06T09:37:00.000Z"
  }
}
```

#### DELETE /users/:id (Admin only)

Delete a user. Admin cannot delete their own account.

**Response:**

```json
{
  "ok": true
}
```

## User Roles

- **admin**: Can manage all users and access all endpoints
- **user**: Can only view/update their own profile

## Error Responses

All endpoints return error responses in this format:

```json
{
  "error": "Error message"
}
```

Common HTTP status codes:

- `400`: Bad Request (missing/invalid data)
- `401`: Unauthorized (missing/invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (user doesn't exist)
- `409`: Conflict (email already exists)
- `500`: Internal Server Error

## Environment Variables

- `JWT_SECRET`: Secret key for JWT signing (default: `reef-default-secret-change-in-production`)
- `DEFAULT_ADMIN_EMAIL`: Default admin email (default: `admin@reef.local`)
- `DEFAULT_ADMIN_PASSWORD`: Default admin password (default: `admin123`)

## Testing the API

You can test the API using curl:

```bash
# Login
curl -X POST http://localhost:7777/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@reef.local","password":"admin123"}'

# Create user (replace TOKEN with actual JWT)
curl -X POST http://localhost:7777/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"email":"test@example.com","name":"Test User","password":"password123"}'

# List users
curl -X GET http://localhost:7777/users \
  -H "Authorization: Bearer TOKEN"

# Get current user
curl -X GET http://localhost:7777/users/me \
  -H "Authorization: Bearer TOKEN"
```
