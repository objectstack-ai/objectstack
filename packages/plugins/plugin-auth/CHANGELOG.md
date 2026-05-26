# Changelog

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- de239ef: Fix WebContainer (StackBlitz) sign-up / sign-in failing with
  `INTERNAL_SERVER_ERROR: No request state found. Please make sure you are
calling this function within a `runWithRequestState` callback.`

  WebContainer reports itself as Node.js but its `node:async_hooks`
  implementation does not propagate `AsyncLocalStorage` context across
  `await` boundaries. As a result, better-auth's `runWithRequestState`
  wrap installed by `handleRequest` was lost as soon as the inner
  `customSession` → `getSession()` call chain awaited anything, and every
  endpoint that reads request state (e.g. `should-session-refresh`,
  `oauth`) threw "No request state found".

  `AuthManager` now detects WebContainer and pre-populates better-auth's
  global `requestStateAsyncStorage` slot with a synchronous polyfill
  before better-auth instantiates its own. The polyfill correctly
  propagates the store through awaited promises within a single
  `run()` call, which is sufficient for WebContainer's single-flight
  dev server. Production environments (real Node, Bun, edge runtimes)
  continue to use the native `AsyncLocalStorage` and are unaffected.

  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- 0bf6f9a: Add explicit `@better-auth/core` dependency.

  `plugin-auth` already pulled `@better-auth/core` transitively via `@better-auth/oauth-provider`, but several call sites in `auth-manager.ts` import from it directly. Promote it to a first-class dependency so the resolved version is stable across the workspace and `pnpm install` doesn't surface "module not found" against the transitive copy under stricter peer resolution.

  No behaviour change.

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Minor Changes

- b4c74a9: WebContainer (StackBlitz) signup compatibility: `AuthManager` now auto-detects
  WebContainer runtimes at construction time and swaps better-auth's default
  `node:crypto.scrypt`-based password hasher for the pure-JS hasher from
  `@better-auth/utils/password` (which uses `@noble/hashes/scrypt` under the
  hood).

  **Why:** WebContainer's `node:crypto` polyfill ships an incomplete `scrypt`
  implementation that throws `TypeError: y.run is not a function` on every
  signup, blocking template demos on StackBlitz. The pure-JS implementation is
  byte-compatible with the Node hasher (same scrypt params, same `salt:keyHex`
  storage format), so accounts created under either hasher remain mutually
  verifiable — no migration, no template changes.

  **Scope:** detection short-circuits to `undefined` on real Node, so production
  deployments are completely unaffected — the JS fallback module is only
  dynamically imported when one of `process.versions.webcontainer`,
  `SHELL` containing `jsh`, or `STACKBLITZ` env is present.

  Templates (`@template/todo`, `@template/contracts`, …) require no changes;
  the fix lives entirely inside `@objectstack/plugin-auth`.

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## Unreleased

### Minor Changes

- Always register better-auth's `bearer()` plugin so cross-origin browsers
  (where third-party cookies are blocked) and native mobile clients can
  authenticate via `Authorization: Bearer <token>` headers and pick up
  rotated tokens from the `set-auth-token` response header (fixes #1172).

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- 1fe5612: fix vercel
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- 35a1ebb: fix auth
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- e854538: fix beyyer-auth
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- f490991: fix better-auth
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- 0b1d7c9: fix auth
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- cfaabbb: fix: AuthPlugin error handling & database adapter config

  - `AuthManager.handleRequest()` now inspects `response.status >= 500` and logs the error body via `console.error`, since better-auth catches internal errors and returns 500 Responses without throwing.
  - `AuthPlugin.registerAuthRoutes()` also logs 500+ responses via `ctx.logger.error` for structured plugin logging.
  - `createDatabaseConfig()` now wraps the ObjectQL adapter as a `DBAdapterInstance` factory function so better-auth's `getBaseAdapter()` correctly recognises it (via `typeof database === "function"` check) instead of falling through to the Kysely adapter path.

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Unify all package versions with a patch release
- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

All notable changes to `@objectstack/plugin-auth` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.2] - 2026-02-10

### Added

- Initial release of Auth Plugin
- Integration with better-auth library for robust authentication
- Session management and user authentication
- Support for OAuth providers (Google, GitHub, Microsoft, etc.)
- Organization/team support for multi-tenant applications
- Two-factor authentication (2FA)
- Passkey support
- Magic link authentication
- Configurable session expiry and refresh
- Automatic HTTP route registration
- Comprehensive test coverage

### Security

- Secure session token management
- Encrypted secrets support
- Rate limiting capabilities
- CSRF protection

[Unreleased]: https://github.com/objectstack-ai/spec/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/objectstack-ai/spec/releases/tag/v2.0.2
