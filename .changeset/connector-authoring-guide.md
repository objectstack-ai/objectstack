---
---

docs-only: hand-written connector authoring guide at
`content/docs/automation/connectors.mdx` (#4289) — the declarative
`connectors:` path (ADR-0097) finally has a page: the three entry shapes,
per-provider `providerConfig` contracts (`rest` / `openapi` / `mcp`),
`credentialRef`-based auth with the enterprise-tier `oauth2` absence stated
explicitly, boot/reload failure modes, and the showcase pointer. The two
connector-auth entries in `packages/spec/variant-docs.json` flip from
`exempt` to governed, so future auth variants must update the guide.
Releases nothing.
