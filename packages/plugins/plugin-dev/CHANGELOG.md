# @objectstack/plugin-dev

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
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
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/plugin-hono-server@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-i18n@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/service-i18n@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/service-i18n@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-auth@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-security@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-i18n@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/plugin-auth@4.0.3
- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/objectql@4.0.3
- @objectstack/runtime@4.0.3
- @objectstack/rest@4.0.3
- @objectstack/driver-memory@4.0.3
- @objectstack/plugin-hono-server@4.0.3
- @objectstack/plugin-security@4.0.3
- @objectstack/plugin-setup@4.0.3
- @objectstack/service-i18n@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-auth@4.0.2
  - @objectstack/plugin-security@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2
  - @objectstack/service-i18n@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/plugin-auth@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/plugin-security@4.0.0
  - @objectstack/plugin-setup@4.0.0
  - @objectstack/rest@4.0.0
  - @objectstack/service-i18n@4.0.0

## 3.3.1

### Patch Changes

- Updated dependencies [772dc3f]
  - @objectstack/service-i18n@3.3.1
  - @objectstack/spec@3.3.1
  - @objectstack/core@3.3.1
  - @objectstack/objectql@3.3.1
  - @objectstack/runtime@3.3.1
  - @objectstack/rest@3.3.1
  - @objectstack/driver-memory@3.3.1
  - @objectstack/plugin-auth@3.3.1
  - @objectstack/plugin-hono-server@3.3.1
  - @objectstack/plugin-security@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/plugin-auth@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/core@3.3.0
  - @objectstack/objectql@3.3.0
  - @objectstack/runtime@3.3.0
  - @objectstack/rest@3.3.0
  - @objectstack/driver-memory@3.3.0
  - @objectstack/plugin-hono-server@3.3.0
  - @objectstack/plugin-security@3.3.0
  - @objectstack/service-i18n@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/plugin-auth@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9
  - @objectstack/plugin-security@3.2.9
  - @objectstack/service-i18n@3.2.9

## 3.2.8

### Patch Changes

- Updated dependencies [1fe5612]
  - @objectstack/plugin-auth@3.2.8
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8
  - @objectstack/objectql@3.2.8
  - @objectstack/runtime@3.2.8
  - @objectstack/rest@3.2.8
  - @objectstack/driver-memory@3.2.8
  - @objectstack/plugin-hono-server@3.2.8
  - @objectstack/plugin-security@3.2.8
  - @objectstack/service-i18n@3.2.8

## 3.2.7

### Patch Changes

- Updated dependencies [35a1ebb]
  - @objectstack/plugin-auth@3.2.7
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7
  - @objectstack/objectql@3.2.7
  - @objectstack/runtime@3.2.7
  - @objectstack/rest@3.2.7
  - @objectstack/driver-memory@3.2.7
  - @objectstack/plugin-hono-server@3.2.7
  - @objectstack/plugin-security@3.2.7
  - @objectstack/service-i18n@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [83151bc]
  - @objectstack/service-i18n@3.2.6
  - @objectstack/spec@3.2.6
  - @objectstack/core@3.2.6
  - @objectstack/objectql@3.2.6
  - @objectstack/runtime@3.2.6
  - @objectstack/rest@3.2.6
  - @objectstack/driver-memory@3.2.6
  - @objectstack/plugin-auth@3.2.6
  - @objectstack/plugin-hono-server@3.2.6
  - @objectstack/plugin-security@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies [e854538]
  - @objectstack/plugin-auth@3.2.5
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5
  - @objectstack/objectql@3.2.5
  - @objectstack/runtime@3.2.5
  - @objectstack/rest@3.2.5
  - @objectstack/driver-memory@3.2.5
  - @objectstack/plugin-hono-server@3.2.5
  - @objectstack/plugin-security@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [f490991]
  - @objectstack/plugin-auth@3.2.4
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4
  - @objectstack/objectql@3.2.4
  - @objectstack/runtime@3.2.4
  - @objectstack/rest@3.2.4
  - @objectstack/driver-memory@3.2.4
  - @objectstack/plugin-hono-server@3.2.4
  - @objectstack/plugin-security@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [0b1d7c9]
  - @objectstack/plugin-auth@3.2.3
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3
  - @objectstack/objectql@3.2.3
  - @objectstack/runtime@3.2.3
  - @objectstack/rest@3.2.3
  - @objectstack/driver-memory@3.2.3
  - @objectstack/plugin-hono-server@3.2.3
  - @objectstack/plugin-security@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [cfaabbb]
- Updated dependencies [46defbb]
  - @objectstack/plugin-auth@3.2.2
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/plugin-security@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-auth@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/plugin-security@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-auth@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/plugin-security@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-auth@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/plugin-security@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-auth@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/plugin-security@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-auth@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/plugin-security@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-auth@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/plugin-security@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-auth@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/plugin-security@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-auth@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/plugin-security@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-auth@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/plugin-security@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-auth@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/plugin-security@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-auth@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/plugin-security@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-auth@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/plugin-security@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-auth@3.0.3
  - @objectstack/plugin-hono-server@3.0.3
  - @objectstack/plugin-security@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-auth@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/plugin-security@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-auth@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/plugin-security@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-auth@3.0.0
  - @objectstack/plugin-hono-server@3.0.0
  - @objectstack/plugin-security@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-auth@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/plugin-security@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7
