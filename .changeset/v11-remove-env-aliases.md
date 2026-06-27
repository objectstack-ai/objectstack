---
"@objectstack/types": minor
"@objectstack/objectql": minor
"@objectstack/cli": minor
---

Remove ObjectStack's own legacy env-var aliases (11.0); ecosystem-standard names stay.

The framework's renamed env vars no longer accept their old ObjectStack names —
rename them:

| removed legacy name | use |
|---|---|
| `OS_MULTI_TENANT` | `OS_MULTI_ORG_ENABLED` |
| `OBJECTSTACK_METADATA_WRITABLE` | `OS_METADATA_WRITABLE` |
| `OS_AUTH_BASE_URL`, `AUTH_BASE_URL` | `OS_AUTH_URL` |

**Ecosystem-standard names are NOT removed** — they remain accepted (and no longer
emit a deprecation warning, since they are permanent conventions, not legacy):
`DATABASE_URL`, `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`,
`CORS_*`, `LOG_LEVEL`, `ROOT_DOMAIN`, `MCP_SERVER_*`. The generic
`readEnvWithDeprecation` helper is unchanged.
