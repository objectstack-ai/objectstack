---
"@objectstack/spec": major
---

refactor(spec)!: retire `system/http-server.zod.ts`'s runtime vocabulary — the event, capability and status shapes nothing ever emitted (#5295)

`ServerEventType`, `ServerEventSchema` / `ServerEvent`, `ServerCapabilitiesSchema` /
`ServerCapabilities` / `ServerCapabilitiesParsed` and `ServerStatusSchema` /
`ServerStatus` are REMOVED under ADR-0049 enforce-or-remove. This is the second and
final pass over the file: #4938 removed its CONFIG half (`HttpServerConfigSchema`,
nine keys, zero readers, zero authoring entry), and this removes the RUNTIME half —
a 7-member lifecycle event union, an eight-boolean capability report and a
five-state status record with connection and request counters. Nothing ever emitted,
consumed or parsed any of them.

FROM → TO:

| removed | what actually decides it |
|---|---|
| `ServerEventType` / `ServerEvent(Schema)` | nothing emits a server event feed. Lifecycle is the transport plugin's own start/stop seam; observability is `system/metrics.zod.ts` + `system/logging.zod.ts`, and `OS_SERVER_TIMING` for timings |
| `ServerCapabilities(Schema/Parsed)` | a transport plugin declares what it provides by implementing the kernel plugin contract — the seams it registers ARE the capability statement |
| `ServerStatus(Schema)` | `/health` for liveness, the metrics surface for counters |

**The fix:** delete the import. There is no replacement key, because there was
never a key — none of the four was authorable on any shape. Server-level
configuration that IS authorable is untouched: `defineStack({ server: { trustProxy,
security } })` / `StackServerConfigSchema` (#5006) parses exactly as it did in 16.x,
as does the route-registration half of the same module (`RouteHandlerMetadata`,
`MiddlewareType`, `MiddlewareConfig`).

**Why now, and what unblocked it.** The card was held rather than queued on a real
doubt: a response/capability vocabulary can legitimately be a REFERENCE surface for
host implementers, so "zero consumers in this repo" is weaker evidence for one of
those than for an authorable key. It was lifted by measuring the reference reader
itself — `plugin-hono-server`, the one in-tree host implementation, neither
implements nor reports any of the three: it names no capability record, no status
shape and no event union, and what it registers is routes and middleware. The
control passed in the same sweep (`MiddlewareConfig`, twelve lines away, resolves to
`packages/runtime/src/middleware.ts`).

The retirement kit — route 3 of the retirement playbook, as #4938 was in this same
file: **no `retiredKey()` tombstone and no D2 conversion**, because a prescription
nobody can receive is noise and there is no authored document to rewrite.
`RETIRED_DEFS_BY_MAJOR[17]` (4 defs) plus the D3 `SemanticMigration`
`http-server-runtime-vocabulary-retired` are the declaration; the generated
baselines (`json-schema.manifest/system.json`, `authorable-surface/system.json`,
`api-surface/system.json`) lose their entries in the same change, deliberately.

If host-implementer conformance becomes a real requirement it returns through the
ENFORCE route: an adapter contract with a checker behind it, vocabulary second.

<!-- adr-0087: registered http-server-runtime-vocabulary-retired -->
