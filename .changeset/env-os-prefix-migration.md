---
'@objectstack/types': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/objectql': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-dev': patch
'@objectstack/plugin-mcp-server': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-ai': patch
'@objectstack/service-settings': patch
'@objectstack/hono': patch
---

**`OS_` env-var prefix migration** (issue #1382).

All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
names still work for one release and emit a one-shot deprecation warning via
the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

**Renamed (with legacy fallback):**

| New | Legacy (deprecated) |
|:---|:---|
| `OS_AUTH_SECRET` | `AUTH_SECRET` |
| `OS_AUTH_BASE_URL` | `AUTH_BASE_URL` |
| `OS_ROOT_DOMAIN` | `ROOT_DOMAIN` |
| `OS_MULTI_ORG_ENABLED` | `OS_MULTI_TENANT` |
| `OS_CORS_ENABLED` | `CORS_ENABLED` |
| `OS_CORS_ORIGIN` | `CORS_ORIGIN` |
| `OS_CORS_CREDENTIALS` | `CORS_CREDENTIALS` |
| `OS_CORS_MAX_AGE` | `CORS_MAX_AGE` |
| `OS_AI_MODEL` | `AI_MODEL` |
| `OS_MCP_SERVER_ENABLED` | `MCP_SERVER_ENABLED` |
| `OS_MCP_SERVER_NAME` | `MCP_SERVER_NAME` |
| `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT` |
| `OS_NODE_ID` | `OBJECTSTACK_NODE_ID` |
| `OS_METADATA_WRITABLE` | `OBJECTSTACK_METADATA_WRITABLE` |
| `OS_DEV_CRYPTO_KEY` | `OBJECTSTACK_DEV_CRYPTO_KEY` |
| `OS_HOME` | `OBJECTSTACK_HOME` |

**Migration:** rename in your `.env`. Legacy names continue to work this
release and will be removed in a future major. Industry-standard names
(`PORT`, `DATABASE_URL`, `NODE_ENV`, `OPENAI_API_KEY`, `TURSO_*`,
`BETTER_AUTH_URL`, OAuth `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`,
`POSTMARK_TOKEN`, `AI_GATEWAY_*`) are NOT renamed.
