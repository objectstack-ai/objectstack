# @objectstack/hono

## 8.0.0

### Patch Changes

- e15c845: feat(hono): re-export the `Hono` type from `@objectstack/hono`

  Downstream apps that consume `createHonoApp()` only need the `Hono` type to
  annotate the returned app. They can now `import type { Hono } from '@objectstack/hono'`
  instead of adding their own `hono` dependency, which guarantees a single
  `hono` across a `link:`/cross-package boundary (no duplicate-package
  type-identity errors, no version-pin alignment). `hono` remains a normal
  runtime dependency of this package, so standalone usage is unaffected.

- Updated dependencies [f68be58]
- Updated dependencies [93f97b2]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [c262301]
  - @objectstack/runtime@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/plugin-hono-server@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [424ab26]
  - @objectstack/runtime@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- @objectstack/plugin-hono-server@7.7.0
- @objectstack/runtime@7.7.0
- @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- Updated dependencies [8e539cc]
  - @objectstack/runtime@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/types@7.5.0
- @objectstack/plugin-hono-server@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/types@7.4.1
- @objectstack/plugin-hono-server@7.4.1

## 7.4.0

### Patch Changes

- @objectstack/plugin-hono-server@7.4.0
- @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- @objectstack/plugin-hono-server@7.3.0
- @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/plugin-hono-server@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/plugin-hono-server@7.2.0

## 7.1.0

### Patch Changes

- @objectstack/plugin-hono-server@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-hono-server@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/plugin-hono-server@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/plugin-hono-server@6.8.1

## 6.8.0

### Patch Changes

- @objectstack/plugin-hono-server@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/plugin-hono-server@6.7.1

## 6.7.0

### Patch Changes

- @objectstack/plugin-hono-server@6.7.0

## 6.6.0

### Patch Changes

- @objectstack/plugin-hono-server@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/plugin-hono-server@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/plugin-hono-server@6.5.0

## 6.4.0

### Patch Changes

- @objectstack/plugin-hono-server@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/plugin-hono-server@6.3.0

## 6.2.0

### Patch Changes

- @objectstack/plugin-hono-server@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/plugin-hono-server@6.1.1

## 6.1.0

### Patch Changes

- @objectstack/plugin-hono-server@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [944f187]
  - @objectstack/runtime@6.0.0
  - @objectstack/plugin-hono-server@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [b806f58]
  - @objectstack/plugin-hono-server@5.2.0

## 5.1.0

### Patch Changes

- @objectstack/plugin-hono-server@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
  - @objectstack/runtime@5.0.0
  - @objectstack/plugin-hono-server@5.0.0

## 4.2.0

### Patch Changes

- @objectstack/plugin-hono-server@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/plugin-hono-server@4.1.1

## 4.1.0

### Patch Changes

- @objectstack/plugin-hono-server@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/plugin-hono-server@4.0.5

## 4.0.4

### Patch Changes

- @objectstack/runtime@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/runtime@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
  - @objectstack/runtime@4.0.2

## 4.0.0

### Patch Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/runtime@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/runtime@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/runtime@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/runtime@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/runtime@3.2.8

## 3.2.8

### Patch Changes

- fix: unified catch-all dispatch pattern — `createHonoApp()` now delegates all non-framework-specific routes to `HttpDispatcher.dispatch()`, automatically supporting packages, analytics, automation, i18n, ui, openapi, custom endpoints, and any future routes
- fix: resolves 404 errors for `/api/v1/meta` and `/api/v1/packages` after Vercel deployment
- Only auth (service check), storage (formData), GraphQL (raw result), and discovery (response wrapper) remain as explicit routes
- Added comprehensive tests for the catch-all dispatch pattern

## 3.2.7

### Patch Changes

- @objectstack/runtime@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/runtime@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/runtime@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/runtime@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/runtime@3.2.3

## 3.2.2

### Patch Changes

- @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/runtime@3.0.3

## 3.0.2

### Patch Changes

- @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@3.0.0

## 2.0.7

### Patch Changes

- @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.6

## 2.0.5

### Patch Changes

- @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.3

## 2.0.2

### Patch Changes

- @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.1

## 2.0.0

### Patch Changes

- @objectstack/runtime@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/runtime@1.0.11

## 1.0.10

### Patch Changes

- @objectstack/runtime@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/runtime@1.0.9

## 1.0.8

### Patch Changes

- 8f2a3a2: fix: standardize discovery endpoint response to include 'data' wrapper
  - @objectstack/runtime@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7

## 1.0.6

### Patch Changes

- @objectstack/runtime@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/runtime@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/runtime@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
  - @objectstack/runtime@1.0.3

## 1.0.2

### Patch Changes

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/runtime@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.0
