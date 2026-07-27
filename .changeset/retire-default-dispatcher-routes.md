---
"@objectstack/spec": minor
---

feat(spec)!: delete `DEFAULT_DISPATCHER_ROUTES` — the dead route table that
underwrote a false compliance verdict (#3586, #3563 follow-up)

The const was consumed by nothing in the runtime — only its own tests and
`api-surface.json`. It listed dispatcher branches that never existed
(`/workflow`, `/realtime`) while omitting eight real prefixes (`/keys`,
`/mcp`, `/mcp/skill`, `/actions`, `/security`, `/share-links`, `/ready`,
`/openapi.json`), and `CLIENT_SPEC_COMPLIANCE.md` anchored a "FULLY
COMPLIANT" verdict on it while 27 real routes had no SDK expression.

The audited, guard-enforced source of truth for the dispatcher's route
surface is `packages/runtime/src/route-ledger.ts` (#3569): the conformance
suite fails when the registry and the ledger drift, which the dead table
never could.

Also swept the last GraphQL fixture debris that #3562's surface removal
left behind: registry test fixtures renamed to honest OData naming, the
tautological `config.graphql` assertions dropped, and the stale
`"type": "graphql"` JSDoc example in `registry.zod.ts` corrected.

Breaking for anyone importing `DEFAULT_DISPATCHER_ROUTES` (a repo-wide and
objectui-wide grep shows zero consumers); shipped as minor per the
launch-window convention, cf. #3562/#3581.
