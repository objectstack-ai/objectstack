# @objectstack/nuxt

## 10.3.0

### Patch Changes

- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/runtime@10.3.0

## 10.2.0

### Patch Changes

- @objectstack/runtime@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/runtime@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [e16f2a8]
- Updated dependencies [47d978a]
- Updated dependencies [220ce5b]
  - @objectstack/runtime@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [2afb612]
  - @objectstack/runtime@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/runtime@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/runtime@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [11af299]
- Updated dependencies [83fd318]
- Updated dependencies [9afeb2d]
  - @objectstack/runtime@9.9.0

## 9.8.0

### Patch Changes

- @objectstack/runtime@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/runtime@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [71578f2]
  - @objectstack/runtime@9.6.0

## 9.5.1

### Patch Changes

- @objectstack/runtime@9.5.1

## 9.5.0

### Patch Changes

- @objectstack/runtime@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [0856476]
  - @objectstack/runtime@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
  - @objectstack/runtime@9.3.0

## 9.2.0

### Patch Changes

- @objectstack/runtime@9.2.0

## 9.1.0

### Patch Changes

- @objectstack/runtime@9.1.0

## 9.0.1

### Patch Changes

- @objectstack/runtime@9.0.1

## 9.0.0

### Patch Changes

- @objectstack/runtime@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/runtime@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [f68be58]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [c262301]
  - @objectstack/runtime@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [424ab26]
  - @objectstack/runtime@7.8.0

## 7.7.0

### Patch Changes

- @objectstack/runtime@7.7.0

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

## 7.5.0

## 7.4.1

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/runtime@7.0.0

## 6.9.0

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [944f187]
  - @objectstack/runtime@6.0.0

## 5.2.0

## 5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
  - @objectstack/runtime@5.0.0

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

### Patch Changes

- @objectstack/runtime@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/runtime@4.0.3

## 4.0.2

### Patch Changes

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

- fix: unified catch-all dispatch pattern — `createH3Router()` now delegates all non-framework-specific routes to `HttpDispatcher.dispatch()`, automatically supporting packages, analytics, automation, i18n, ui, openapi, custom endpoints, and any future routes
- Only auth (service check), storage (multipart), GraphQL (raw result), and discovery (response wrapper) remain as explicit routes

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

- Updated dependencies [c7267f6]
  - @objectstack/runtime@3.0.3
