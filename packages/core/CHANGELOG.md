# @objectstack/core

## 8.0.0

### Minor Changes

- c262301: fix(rest): REST data API honors sys_api_key — one shared verifier with MCP (closes #1633)

  Staging e2e found the MCP surface authenticated a `sys_api_key` but the REST data
  API (`@objectstack/rest`) returned 401 for the same key — its `resolveExecCtx`
  only checked the better-auth session, never the API key.

  Converged both surfaces onto ONE verifier so they can't drift:

  - **`@objectstack/core/security`** now owns the shared `sys_api_key` primitives
    (`hashApiKey`, `generateApiKey`, `extractApiKey`, `parseScopes`, `isExpired`)
    plus a new `resolveApiKeyPrincipal(ql, headers, nowMs?)` that hashes the
    inbound key, looks it up by the indexed at-rest hash, and rejects unknown /
    revoked / expired / owner-less keys (fail-closed). `core` is the natural home:
    both `rest` and `runtime` depend on it, it depends on neither (no cycle), and
    it's server-side (already uses `node:crypto`).
  - **`@objectstack/runtime`** — `security/api-key.ts` re-exports the primitives
    from core (stable import surface) and `resolveExecutionContext` now delegates
    its API-key branch to `resolveApiKeyPrincipal`.
  - **`@objectstack/rest`** — `resolveExecCtx` resolves the data engine once and
    tries `resolveApiKeyPrincipal` (x-api-key / `Authorization: ApiKey`) BEFORE the
    session, so `/api/v1/data` + `/api/v1/meta` now authenticate an API key under
    the key's permissions + RLS, exactly like the dispatcher/MCP path.

  Tests: core `api-key.test.ts` (primitives + verifier: valid / revoked / expired /
  unknown / owner-less / plaintext-not-matched / fail-closed-ql). runtime + rest
  suites green.

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0

## 7.3.0

### Patch Changes

- 5e7c554: **Rename kernel plugin-sandbox permission schemas to remove a naming footgun** (issue #1383).

  `@objectstack/spec/kernel` exported `PermissionSchema` / `PermissionSetSchema`
  (and the `Permission` / `PermissionSet` types) for the plugin-sandbox security
  model. Their names collided with the metadata-protocol permission set exported
  from `@objectstack/spec/security` (`PermissionSetSchema`), making it very easy
  to validate the `permission`/`profile` metadata type against the wrong schema
  and reject every legal payload.

  The kernel symbols are now prefixed with `Plugin` to reflect their specialized
  semantics:

  | Old (`@objectstack/spec/kernel`) | New                         |
  | :------------------------------- | :-------------------------- |
  | `PermissionSchema`               | `PluginPermissionSchema`    |
  | `PermissionSetSchema`            | `PluginPermissionSetSchema` |
  | `Permission` (type)              | `PluginPermission`          |
  | `PermissionSet` (type)           | `PluginPermissionSet`       |

  The metadata `permission`/`profile` types are unchanged — keep using
  `PermissionSetSchema` from `@objectstack/spec/security`.

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2

## 4.0.0

### Minor Changes

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11

## 1.0.10

### Patch Changes

- 10f52e1: fix: silence unhandled promise rejections when checking for async services in kernel
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4

## 1.0.3

### Patch Changes

- fb2eabd: fix: resolve "process is not defined" runtime error in browser environments by adding safe environment detection and polyfills
  - @objectstack/spec@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
