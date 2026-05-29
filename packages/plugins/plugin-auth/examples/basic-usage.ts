// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth Plugin Usage Example
 * 
 * This example demonstrates how to use the AuthPlugin with better-auth
 * in an ObjectStack application. All requests are forwarded directly
 * to better-auth's universal handler.
 */

import { ObjectKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { AuthPlugin } from '@objectstack/plugin-auth';

// Create kernel
const kernel = new ObjectKernel();

// Initialize the kernel
async function main() {
  try {
    // Register HTTP server plugin
    await kernel.use(new HonoServerPlugin({
      port: 3000,
    }));
    
    // Register auth plugin
    await kernel.use(new AuthPlugin({
      secret: process.env.OS_AUTH_SECRET || 'your-secret-key-at-least-32-chars',
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      databaseUrl: process.env.DATABASE_URL,
      
      // OAuth providers (optional)
      providers: [
        {
          id: 'google',
          clientId: process.env.GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          scope: ['email', 'profile'],
        },
        {
          id: 'github',
          clientId: process.env.GITHUB_CLIENT_ID || '',
          clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        },
      ],
      
      // Additional auth features (optional)
      plugins: {
        organization: true,  // Multi-tenant support
        twoFactor: true,     // 2FA support
        passkeys: false,     // Passkey support
        magicLink: true,     // Magic link login
      },
      
      // Session configuration (optional)
      session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24,     // Update every 24 hours
      },
      
      // Route configuration
      registerRoutes: true,
      basePath: '/api/v1/auth',
    }));

    // Bootstrap the kernel
    await kernel.bootstrap();
    
    console.log('🚀 Server started with auth plugin');
    console.log('📍 Better-auth endpoints available at:');
    console.log('');
    console.log('   Email/Password:');
    console.log('   - POST http://localhost:3000/api/v1/auth/sign-up/email');
    console.log('   - POST http://localhost:3000/api/v1/auth/sign-in/email');
    console.log('   - POST http://localhost:3000/api/v1/auth/sign-out');
    console.log('   - GET  http://localhost:3000/api/v1/auth/get-session');
    console.log('');
    console.log('   Password Management:');
    console.log('   - POST http://localhost:3000/api/v1/auth/forget-password');
    console.log('   - POST http://localhost:3000/api/v1/auth/reset-password');
    console.log('');
    console.log('   OAuth (if configured):');
    console.log('   - GET  http://localhost:3000/api/v1/auth/authorize/google');
    console.log('   - GET  http://localhost:3000/api/v1/auth/authorize/github');
    console.log('');
    console.log('   See https://www.better-auth.com/docs for complete API reference');
    console.log('');
    
    // Access the auth service from the kernel
    const authService = kernel.getService('auth');
    console.log('✅ Auth service registered:', !!authService);
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await kernel.shutdown();
  process.exit(0);
});

// Start the application
main();
