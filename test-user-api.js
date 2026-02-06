#!/usr/bin/env node

/**
 * Test script for User Management API
 * Usage: node test-user-api.js
 */

const API_BASE = 'http://localhost:7777'

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })
  
  const data = await response.json()
  
  console.log(`${options.method || 'GET'} ${endpoint}`)
  console.log(`Status: ${response.status}`)
  console.log('Response:', JSON.stringify(data, null, 2))
  console.log('---')
  
  return { response, data }
}

async function testUserAPI() {
  try {
    console.log('🧪 Testing User Management API\n')
    
    // 1. Login as admin
    console.log('1. Login as default admin')
    const loginResult = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@reef.local',
        password: 'admin123'
      })
    })
    
    if (loginResult.response.status !== 200) {
      console.error('❌ Failed to login')
      return
    }
    
    const token = loginResult.data.token
    const authHeaders = { Authorization: `Bearer ${token}` }
    
    // 2. Get current user
    console.log('2. Get current user profile')
    await request('/users/me', {
      headers: authHeaders
    })
    
    // 3. Create a new user
    console.log('3. Create a new user')
    const createResult = await request('/users', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
        role: 'user'
      })
    })
    
    const newUserId = createResult.data.user?.id
    
    // 4. List all users
    console.log('4. List all users')
    await request('/users', {
      headers: authHeaders
    })
    
    if (newUserId) {
      // 5. Get specific user
      console.log('5. Get specific user')
      await request(`/users/${newUserId}`, {
        headers: authHeaders
      })
      
      // 6. Update user
      console.log('6. Update user')
      await request(`/users/${newUserId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Updated Test User'
        })
      })
      
      // 7. Login as new user
      console.log('7. Login as new user')
      const userLoginResult = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        })
      })
      
      if (userLoginResult.response.status === 200) {
        const userToken = userLoginResult.data.token
        const userAuthHeaders = { Authorization: `Bearer ${userToken}` }
        
        // 8. User updates their own profile
        console.log('8. User updates their own profile')
        await request(`/users/${newUserId}`, {
          method: 'PUT',
          headers: userAuthHeaders,
          body: JSON.stringify({
            name: 'Self-Updated Name'
          })
        })
        
        // 9. User tries to access admin endpoint (should fail)
        console.log('9. User tries to access admin endpoint (should fail)')
        await request('/users', {
          headers: userAuthHeaders
        })
      }
      
      // 10. Delete user (as admin)
      console.log('10. Delete user')
      await request(`/users/${newUserId}`, {
        method: 'DELETE',
        headers: authHeaders
      })
    }
    
    // 11. Test invalid login
    console.log('11. Test invalid login')
    await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'invalid@example.com',
        password: 'wrongpassword'
      })
    })
    
    console.log('✅ API tests completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This script requires Node.js 18+ for fetch support')
  console.log('💡 Or install node-fetch: npm install node-fetch')
  process.exit(1)
}

testUserAPI()