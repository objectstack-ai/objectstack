# Better-Auth Integration: Direct Forwarding Approach

## Decision Summary

**Chosen Approach:** Direct Request Forwarding  
**Implementation Date:** 2026-02-10  
**Status:** ✅ Implemented and Tested

## Problem Statement

When integrating the better-auth library (v1.4.18) into `@objectstack/plugin-auth`, we needed to decide between two architectural approaches:

1. **Direct Forwarding**: Forward all HTTP requests directly to better-auth's universal handler
2. **Manual Implementation**: Implement wrapper methods for each authentication operation

## Analysis

### Better-Auth Architecture

Better-auth v1.4.18 provides a **universal handler** pattern:

```typescript
type Auth = {
  handler: (request: Request) => Promise<Response>;
  api: InferAPI<...>;
  // ...
}
```

This handler:
- Accepts Web standard `Request` objects
- Returns Web standard `Response` objects  
- Handles ALL authentication routes internally
- Is framework-agnostic (works with Next.js, Hono, Express, etc.)

### Hono Framework Compatibility

Our HTTP server uses Hono, which already uses Web standard Request/Response:
- Hono Context provides `c.req.raw` → Web `Request`
- Hono accepts Web `Response` objects directly
- **No conversion needed!**

### Approach Comparison

| Aspect | Direct Forwarding ✅ | Manual Implementation |
|--------|---------------------|----------------------|
| Code Size | ~100 lines | ~250 lines |
| Maintenance | Minimal - better-auth handles it | High - must sync with better-auth updates |
| Features | All better-auth features automatic | Must implement each feature manually |
| Type Safety | Full TypeScript from better-auth | Custom types, may drift |
| Bug Risk | Low - using library as designed | High - custom code, edge cases |
| Updates | Get better-auth updates automatically | Must update wrapper code |
| OAuth Support | Built-in, configured via options | Must implement OAuth flows |
| 2FA Support | Backend plugin wiring, configured via options; UI must handle enrollment/challenge/recovery | Must implement 2FA logic |
| Passkeys | Built-in, configured via options | Must implement WebAuthn |
| Magic Links | Built-in, configured via options | Must implement email flows |

## Decision: Direct Forwarding

### Rationale

1. **Library Design Intent**: Better-auth's universal handler is the **recommended integration pattern**
2. **Minimal Code**: ~150 lines removed, simpler to maintain
3. **Full Feature Support**: All better-auth features work automatically
4. **Future-Proof**: Better-auth updates require no code changes
5. **Type Safety**: Full TypeScript support from better-auth
6. **Standard Pattern**: Aligns with better-auth documentation examples

### Implementation

#### Before (Manual Approach)
```typescript
// Custom wrapper methods (200+ lines)
httpServer.post('/auth/login', async (req, res) => {
  const result = await authManager.login(req.body);
  res.json(result);
});

httpServer.post('/auth/register', async (req, res) => {
  const result = await authManager.register(req.body);
  res.json(result);
});

// ... many more routes
```

#### After (Direct Forwarding)
```typescript
// Single wildcard route (~30 lines)
rawApp.all('/api/v1/auth/*', async (c) => {
  const request = c.req.raw; // Web Request
  const authPath = url.pathname.replace(basePath, '');
  const rewrittenRequest = new Request(authPath, { ... });
  const response = await authManager.handleRequest(rewrittenRequest);
  return response; // Web Response
});
```

### Trade-offs

**Given Up:**
- Fine-grained control over individual routes
- Ability to easily intercept/modify requests

**Solutions:**
- Use Hono middleware for request interception if needed
- Use better-auth plugins for custom behavior
- Access `await authManager.getApi()` for programmatic operations

## Results

### Metrics
- **Lines of Code Removed**: 156 (261 → 105 in auth-manager.ts)
- **Test Coverage**: 11/11 tests passing
- **Build Status**: ✅ Success
- **Type Safety**: ✅ Full TypeScript support

### Features Enabled
- ✅ Email/Password Authentication
- ✅ OAuth Providers (Google, GitHub, etc.)
- ✅ Session Management
- ✅ Password Reset
- ✅ Email Verification
- ⚠️ Backend 2FA wiring (when enabled; custom UI required)
- ✅ Passkeys (when enabled)
- ✅ Magic Links (when enabled)
- ✅ Organizations (when enabled)

## Usage Example

```typescript
import { AuthPlugin } from '@objectstack/plugin-auth';

const plugin = new AuthPlugin({
  secret: process.env.AUTH_SECRET,
  baseUrl: 'http://localhost:3000',
  
  // OAuth providers - just configuration, no implementation needed
  providers: [
    {
      id: 'google',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }
  ],
  
  // Advanced features - just enable, no implementation needed
  plugins: {
    organization: true,  // Multi-tenant support
    twoFactor: true,     // Backend 2FA endpoints for a custom UI
    passkeys: true,      // WebAuthn
    magicLink: true,     // Passwordless
  }
});
```

Better-auth endpoints are forwarded immediately:
- `/api/v1/auth/sign-up/email`
- `/api/v1/auth/sign-in/email`
- `/api/v1/auth/authorize/google`
- `/api/v1/auth/two-factor/enable`
- `/api/v1/auth/passkey/register`
- And many more...

For 2FA specifically, do not expose it as an end-user feature until the UI
also handles TOTP confirmation, the password sign-in `twoFactorRedirect`
challenge, and backup-code recovery.

## Lessons Learned

1. **Use Libraries as Designed**: Better-auth provides a universal handler for a reason
2. **Less Code = Less Bugs**: The simplest solution is often the best
3. **Trust the Framework**: Better-auth has battle-tested auth logic
4. **Embrace Standards**: Web standard Request/Response makes integration seamless

## References

- [Better-Auth Documentation](https://www.better-auth.com/docs)
- [PR #580](https://github.com/objectstack-ai/spec/pull/580) - Initial better-auth integration
- Analysis Document: `/tmp/better-auth-approach-analysis.md`
