# @objectstack/plugin-auth

Authentication & Identity Plugin for ObjectStack.

> **✨ Status:** ObjectQL-based authentication implementation! Uses ObjectQL for data persistence (no third-party ORM required). Core authentication structure is in place with better-auth v1.4.18.

## Features

### Currently Implemented
- ✅ Plugin structure following ObjectStack conventions
- ✅ HTTP route registration for auth endpoints
- ✅ Service registration in ObjectKernel
- ✅ Configuration schema support
- ✅ **Better-Auth library integration (v1.4.18)**
- ✅ **ObjectQL-based database implementation (no ORM required)**
- ✅ **Direct request forwarding to better-auth handler**
- ✅ **Wildcard routing (`/api/v1/auth/*`)**
- ✅ **Full better-auth API access via `auth.api`**
- ✅ Comprehensive test coverage (11/11 tests passing)

### Production Ready Features
- ✅ **Email/Password Authentication** - Handled by better-auth
- ✅ **OAuth Providers** - Configured via `providers` option
- ✅ **Session Management** - Automatic session handling
- ✅ **Password Reset** - Email-based password reset flow
- ✅ **Email Verification** - Email verification workflow
- ⚠️ **2FA backend wiring** - better-auth two-factor plugin can be enabled for custom UIs
- ✅ **Passkeys** - WebAuthn/Passkey support (when enabled)
- ✅ **Magic Links** - Passwordless authentication (when enabled)
- ✅ **Organizations** - Multi-tenant support (when enabled)
- ✅ **Bearer-token Auth** - Cross-origin and mobile clients can authenticate
  via `Authorization: Bearer <token>` and receive rotated tokens on the
  `set-auth-token` response header (always enabled, no config required).

### ObjectQL-Based Database Architecture
- ✅ **Native ObjectQL Data Persistence** - Uses ObjectQL's IDataEngine interface
- ✅ **No Third-Party ORM** - No dependency on drizzle-orm or other ORMs
- ✅ **Better-Auth Native Schema** - Uses better-auth's naming conventions for seamless migration
- ✅ **Object Definitions** - Auth objects defined using ObjectStack's Object Protocol
  - `sys_user` - User accounts (protocol name, mapped from better-auth's `user`)
  - `sys_session` - Active sessions (protocol name, mapped from better-auth's `session`)
  - `sys_account` - OAuth provider accounts (protocol name, mapped from better-auth's `account`)
  - `sys_verification` - Email/phone verification tokens (protocol name, mapped from better-auth's `verification`)
- ✅ **ObjectQL Adapter** - Custom adapter bridges better-auth to ObjectQL

The plugin uses [better-auth](https://www.better-auth.com/) for robust, production-ready authentication functionality. All requests are forwarded directly to better-auth's universal handler, ensuring full compatibility with all better-auth features. Data persistence is handled by ObjectQL using **ObjectStack's snake_case naming conventions** for field names to maintain consistency across the platform.

## Installation

```bash
pnpm add @objectstack/plugin-auth
```

## Usage

### Basic Setup with ObjectQL

```typescript
import { ObjectKernel } from '@objectstack/core';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { ObjectQL } from '@objectstack/objectql';

// Initialize ObjectQL as the data engine
const dataEngine = new ObjectQL();

const kernel = new ObjectKernel({
  plugins: [
    new AuthPlugin({
      secret: process.env.AUTH_SECRET,
      baseUrl: 'http://localhost:3000',
      // ObjectQL will be automatically injected by the kernel
      providers: [
        {
          id: 'google',
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }
      ]
    })
  ]
});
```

**Note:** The `databaseUrl` parameter is no longer used. The plugin now uses ObjectQL's IDataEngine interface, which is provided by the kernel's `data` service. This allows the plugin to work with any ObjectQL-compatible driver (memory, SQL, NoSQL, etc.) without requiring a specific ORM.

### With Organization Support

```typescript
new AuthPlugin({
  secret: process.env.AUTH_SECRET,
  baseUrl: 'http://localhost:3000',
  plugins: {
    organization: true,  // Enable organization/teams
    twoFactor: true,     // Enable backend 2FA endpoints for a custom UI
    passkeys: true,      // Enable passkey support
  }
})
```

## Configuration

The plugin accepts configuration via `AuthConfig` schema from `@objectstack/spec/system`:

- `secret` - Encryption secret for session tokens
- `baseUrl` - Base URL for auth routes
- `databaseUrl` - Database connection string
- `providers` - Array of OAuth provider configurations
- `plugins` - Enable additional auth features (organization, backend 2FA, passkeys, magic link)
- `session` - Session configuration (expiry, update frequency)

## API Routes

The plugin forwards all requests under `/api/v1/auth/*` directly to better-auth's universal handler. Better-auth provides the following endpoints:

### Email/Password Authentication
- `POST /api/v1/auth/sign-in/email` - Sign in with email and password
- `POST /api/v1/auth/sign-up/email` - Register new user with email and password
- `POST /api/v1/auth/sign-out` - Sign out current user

### Session Management
- `GET /api/v1/auth/get-session` - Get current user session

### Password Management
- `POST /api/v1/auth/forget-password` - Request password reset email
- `POST /api/v1/auth/reset-password` - Reset password with token

### Email Verification
- `POST /api/v1/auth/send-verification-email` - Send verification email
- `GET /api/v1/auth/verify-email` - Verify email with token

### OAuth (when providers configured)
- `GET /api/v1/auth/authorize/[provider]` - Start OAuth flow
- `GET /api/v1/auth/callback/[provider]` - OAuth callback

### 2FA backend (when enabled)
- `POST /api/v1/auth/two-factor/enable` - Start 2FA enrollment
- `POST /api/v1/auth/two-factor/verify-totp` - Verify a TOTP code

The open-source Console does not yet provide a complete TOTP enrollment,
login challenge, and backup-code recovery flow. Keep `plugins.twoFactor`
disabled unless your application UI handles that full flow.

### Passkeys (when enabled)
- `POST /api/v1/auth/passkey/register` - Register a passkey
- `POST /api/v1/auth/passkey/authenticate` - Authenticate with passkey

### Magic Links (when enabled)
- `POST /api/v1/auth/magic-link/send` - Send magic link email
- `GET /api/v1/auth/magic-link/verify` - Verify magic link

For the complete API reference, see [better-auth documentation](https://www.better-auth.com/docs).

## Implementation Status

This package provides authentication services powered by better-auth. Current implementation status:

1. ✅ Plugin lifecycle (init, start, destroy)
2. ✅ HTTP route registration (wildcard routing)
3. ✅ Configuration validation
4. ✅ Service registration
5. ✅ Better-auth library integration (v1.4.18)
6. ✅ Direct request forwarding to better-auth handler
7. ✅ Full better-auth API support
8. ✅ OAuth providers (configurable)
9. ⚠️ Backend 2FA wiring, passkeys, magic links (configurable; custom UI required for 2FA)
10. ✅ ObjectQL-based database implementation (no ORM required)

### Architecture

#### Request Flow

The plugin uses a **direct forwarding** approach:

```typescript
// All requests under /api/v1/auth/* are forwarded to better-auth
rawApp.all('/api/v1/auth/*', async (c) => {
  const request = c.req.raw; // Web standard Request
  const response = await authManager.handleRequest(request);
  return response; // Web standard Response
});
```

This architecture provides:
- ✅ **Minimal code** - No custom route implementations
- ✅ **Full compatibility** - All better-auth features work automatically
- ✅ **Easy updates** - Better-auth updates don't require code changes
- ✅ **Type safety** - Full TypeScript support from better-auth
- ✅ **Programmatic API** - Access auth methods via `await authManager.getApi()`

#### ObjectQL Database Architecture

The plugin uses **ObjectQL** for data persistence instead of third-party ORMs:

```typescript
// Object definitions use ObjectStack's snake_case naming conventions
export const AuthUser = ObjectSchema.create({
  name: 'sys_user',  // ObjectStack protocol name (better-auth model 'user' is mapped automatically)
  fields: {
    id: Field.text({ label: 'User ID', required: true }),
    email: Field.email({ label: 'Email', required: true }),
    email_verified: Field.boolean({ label: 'Email Verified' }),  // snake_case
    name: Field.text({ label: 'Name', required: true }),
    created_at: Field.datetime({ label: 'Created At' }),  // snake_case
    updated_at: Field.datetime({ label: 'Updated At' }),  // snake_case
    // ... other fields
  },
  indexes: [
    { fields: ['email'], unique: true }
  ]
});
```

**Benefits:**
- ✅ **No ORM Dependencies** - No drizzle-orm, Prisma, or other ORMs required
- ✅ **Unified Data Layer** - Uses same data engine as rest of ObjectStack
- ✅ **Driver Agnostic** - Works with memory, SQL, NoSQL via ObjectQL drivers
- ✅ **Type-Safe** - Zod-based schemas provide runtime + compile-time safety
- ✅ **"Data as Code"** - Object definitions are versioned, declarative code
- ✅ **Metadata Driven** - Supports migrations, validation, indexing via metadata
- ✅ **Compatible Schema** - Uses better-auth compatible table structure with ObjectStack's snake_case field naming

**Database Objects:**
Uses ObjectStack `sys_` prefixed protocol names with snake_case field naming.
The adapter automatically maps better-auth model names to protocol names:

*Core models:*
- `sys_user` (← better-auth `user`) - User accounts (id, email, name, email_verified, created_at, etc.)
- `sys_session` (← better-auth `session`) - Active sessions (id, token, user_id, expires_at, ip_address, etc.)
- `sys_account` (← better-auth `account`) - OAuth provider accounts (id, provider_id, account_id, user_id, tokens, etc.)
- `sys_verification` (← better-auth `verification`) - Verification tokens (id, value, identifier, expires_at, etc.)

*Organization plugin (when `plugins.organization: true`):*
- `sys_organization` (← `organization`) - Organizations (id, name, slug, logo, created_at, etc.)
- `sys_member` (← `member`) - Organization members (id, organization_id, user_id, role, created_at)
- `sys_invitation` (← `invitation`) - Invitations (id, organization_id, inviter_id, email, role, expires_at, etc.)
- `sys_team` (← `team`) - Teams (id, name, organization_id, created_at, etc.)
- `sys_team_member` (← `teamMember`) - Team members (id, team_id, user_id, created_at)

*Two-Factor plugin (when `plugins.twoFactor: true`):*
- `sys_two_factor` (← `twoFactor`) - 2FA secrets (id, secret, backup_codes, user_id)

**Schema Mapping (modelName + fields):**

better-auth uses camelCase field names internally (`emailVerified`, `userId`, `createdAt`, etc.)
while ObjectStack's protocol layer uses snake_case (`email_verified`, `user_id`, `created_at`).

The plugin leverages better-auth's official `modelName` / `fields` schema customisation API
to declare the mapping at configuration time. The `createAdapterFactory` wrapper then
transforms data and where-clauses automatically — no runtime camelCase ↔ snake_case
conversion is needed in the adapter itself.

```typescript
// Schema mapping constants (auth-schema-config.ts)
import {
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
  buildOrganizationPluginSchema,
  buildTwoFactorPluginSchema,
} from '@objectstack/plugin-auth';

// Applied to the betterAuth() config:
const auth = betterAuth({
  database: createObjectQLAdapterFactory(dataEngine),
  user:         { ...AUTH_USER_CONFIG },
  session:      { ...AUTH_SESSION_CONFIG, expiresIn: 604800 },
  account:      { ...AUTH_ACCOUNT_CONFIG },
  verification: { ...AUTH_VERIFICATION_CONFIG },
  plugins: [
    organization({ schema: buildOrganizationPluginSchema() }),
    twoFactor({ schema: buildTwoFactorPluginSchema() }),
  ],
});
```

**Adapter Factory:**
The `createObjectQLAdapterFactory()` function uses better-auth's `createAdapterFactory` to
bridge ObjectQL's IDataEngine with better-auth. Model-name and field-name transformations
are applied by the factory wrapper so the adapter code stays simple:

```typescript
import { createObjectQLAdapterFactory } from '@objectstack/plugin-auth';

const adapterFactory = createObjectQLAdapterFactory(dataEngine);
// adapterFactory is (options: BetterAuthOptions) => DBAdapter
```

> **Note:** `AuthManager` handles all of this automatically when you provide a `dataEngine`.
> You only need the factory/config above when using the adapter directly.

A legacy `createObjectQLAdapter()` function (with manual model-name mapping via
`AUTH_MODEL_TO_PROTOCOL`) is still exported for backward compatibility.

## Development

```bash
# Build the plugin
pnpm build

# Run tests
pnpm test
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
