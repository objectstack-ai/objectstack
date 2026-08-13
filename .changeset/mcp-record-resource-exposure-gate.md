---
"@objectstack/mcp": patch
---

fix(mcp): the stdio record resource honours the ADR-0049 `apiEnabled` / `apiMethods` exposure declaration (#8266)

An object that declares `enable.apiEnabled: false` — or narrows `enable.apiMethods`
so a single-record read is outside the whitelist — was refused by the `get_record`
tool and **still readable** through the ADR-0101 record resource
(`objectstack://objects/{objectName}/records/{recordId}`): same transport, same key,
same declaration, two answers.

**This is a surface-area declaration leak, not an authorization bypass.** The gate is
a surface-area control by `api-exposure.ts`'s own ADR note, and this read passed the
ObjectQL security middleware (CRUD / FLS / RLS) — under the key's `ExecutionContext`
— before this change and after it. What was leaking is the author's *exposure
declaration*, not the data guard.

Why the resource was missed when the tool was fixed: the six object-CRUD verbs all
flow through `createStdioDataBridge`, which has been gated since #8083. The record
resource does not use that bridge — its reader is a separate closure built inline in
the plugin that calls `ql.find` directly and is handed to `bridgeResources`. Gating
the bridge therefore never reached it. That reader now applies the same gate, taking
its decision from the same single source of truth every other enforcement point
delegates to (the spec's `resolveEffectiveApiMethods` / `isApiOperationAllowed`), so
the three-state whitelist and the derived verbs resolve identically on all surfaces.

The gated action is `get`, matching what the HTTP path sends for a single-record
read. Refusals carry the same machine codes the REST surface answers with —
`OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` — and reach an MCP client
as the resource's `{ "error": ... }` body, which is how that resource has always
reported a failed read. The behaviours matched to the HTTP path in #8083 are matched
here for the same reasons: a system context bypasses, and unresolvable metadata fails
open to the schema defaults.

Unaffected: the object schema and object list resources stay ungated, because the
HTTP bridge answers both straight off the metadata service — refusing a *schema* read
here would be a fresh divergence pointing the other way. The remaining known
divergences between the two MCP bridges (the protocol layer's ingress `readonly`
strip, its existence probes, its spec-shaped receipts and `expand` / `select`) are
unchanged and still filed as follow-up work.
