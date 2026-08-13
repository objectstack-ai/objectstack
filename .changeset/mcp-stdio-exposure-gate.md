---
"@objectstack/mcp": patch
---

fix(mcp): the stdio transport honours the ADR-0049 `apiEnabled` / `apiMethods` exposure declaration (#8083)

An object that declares `enable.apiEnabled: false` — or narrows `enable.apiMethods` —
is telling the platform which data operations it exposes over the API. That
declaration was honoured on the MCP **HTTP** surface and ignored on the MCP
**stdio** surface: same product, same tool names, same key, different answer.

**This is a surface-area declaration leak, not an authorization bypass.** The gate
is a surface-area control by `api-exposure.ts`'s own ADR note, and every stdio call
passed the ObjectQL security middleware (CRUD / FLS / RLS) before this change and
after it. What was leaking is the author's *exposure declaration*, not the data
guard.

The two MCP hosts implement the same `McpDataBridge` over different seams — HTTP
through `callData`, which gates before dispatch; stdio straight onto the engine,
which did not. The stdio bridge now applies the same gate, and takes its decision
from the same single source of truth both existing enforcement points already
delegate to (the spec's `resolveEffectiveApiMethods` / `isApiOperationAllowed`), so
the three-state whitelist, the action-to-operation mapping and the derived verbs
resolve identically on all three surfaces.

Gated verbs are exactly the six the HTTP bridge routes through `callData`:
`query_records`, `get_record`, `create_record`, `update_record`, `delete_record`
and `aggregate_records`. `list_objects` / `describe_object` stay ungated, because
the HTTP bridge answers both straight off the metadata service — a schema read
refused on stdio and served on HTTP would be the same divergence pointing the
other way.

Refusals carry the same machine codes the REST surface answers with:
`OBJECT_API_DISABLED` (the object is hidden) and `OBJECT_API_METHOD_NOT_ALLOWED`
(the operation is outside the whitelist, with the effective operation set
attached). Three behaviours are matched to the HTTP path deliberately: a system
context bypasses the gate, unresolvable metadata **fails open** to the schema
defaults, and the flat legacy definition shape is read when there is no nested
`enable` block.

Unaffected: the remaining known divergences between the two MCP bridges (the
protocol layer's ingress `readonly` strip, its existence probes, its spec-shaped
receipts and `expand` / `select`) are unchanged and still filed as follow-up work.
