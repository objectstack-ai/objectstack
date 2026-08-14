---
"@objectstack/core": patch
"@objectstack/metadata-protocol": patch
"@objectstack/mcp": patch
---

fix(security): the MCP stdio bridge stops echoing `internal: true` columns from a write, and the write-response guarantee is guarded as a PROPERTY rather than per-class (#8497)

**A live leak, found by widening a guard.** #7823 relocated the `internal: true`
write-response strip to the generic-data-path ingress and gated the relocation on
a tripwire that enumerates every `*Data` face on the protocol class. The card that
produced this change observed that the guard's coverage — *"every `*Data` face on
one class"* — is narrower than the property that needs holding — *"no response body
an external caller receives from a write carries an `internal: true` value"* — and
that `@objectstack/rest`'s cross-object batch (a direct `ql.update`) was the
standing proof the two are not the same set.

Widening the guard to the property immediately found a second direct mouth that
was **not** covered, and it was leaking. `@objectstack/mcp`'s stdio bridge
(`stdio-data-bridge.ts`) is engine-only by construction — the long-lived stdio
host cannot reuse the runtime's request-shaped `callData` builder — and its
`create` arm handed `engine.insert`'s result straight back to the MCP caller.
Since #7823 the engine deliberately keeps its write results whole, so the flagged
column rode the tool response verbatim. Measured before the fix:

```
{"object":"vault","id":"r1","record":{"name":"row","id":"r1","vault_secret":"<the stored secret>"}}
```

The file's own header had listed its protocol-layer divergences as *"deliberate,
filed, not security"*. One limb of that list **was** security, and the header now
says so.

**What changed**

- `@objectstack/mcp` — the stdio bridge's `create` runs its response record
  through the shared strip. `update` does too: that arm discards the engine's
  write result and echoes the read-path row plus the caller's own patch, so no
  *stored* value could reach it, but a caller who puts an `internal: true` key in
  `data` would otherwise get it echoed back — their own bytes used as an oracle
  for a column the flag says is never returned. Read verbs are untouched (the
  engine's read-path strip is unchanged).
- `@objectstack/core` — the strip helper
  (`omitInternalFieldsFromWriteResponse` / `collectInternalWriteResponseFields`)
  moved here from `@objectstack/metadata-protocol`. It shipped beside the protocol
  class when that class was its only caller, but the generic write mouths are not
  all on it: `rest` and `mcp` both reach the engine directly and **neither depends
  on `@objectstack/metadata-protocol`**, so the old home forced each new mouth to
  choose between a duck-typed reach through a protocol instance and a private
  restatement of a security-relevant rule. `core` is the floor all three already
  depend on, and already hosts this class of shared write-path helper
  (`bulk-write.ts`). No behaviour change and no API change:
  `@objectstack/metadata-protocol` re-exports both names unchanged.

**What guards it now.** Two new tripwires join the shipped one — which is **not**
replaced: its runtime prototype walk and its `leakyData` negative control are
untouched. Each is a runtime enumeration no author can dodge by adding code
without touching it, and each fails on a surface it has no disposition for:

- `metadata-protocol` — walks the protocol class for `*Data` faces (unchanged);
- `rest` — walks `RestServer.getRoutes()` for HTTP write routes, drives the ten
  data-plane ones (including `POST /batch`, the direct-`ql.update` mouth) against
  a fixture whose stored rows carry a flagged sentinel, and deep-scans each
  response body;
- `mcp` — walks the `McpDataBridge` faces the factory actually returns.

Every driven case also asserts a control value is present, so a refusal or an
empty body cannot satisfy "no sentinel" by returning nothing.

Reverse-verified in both directions, the discipline #7823's own fix used: deleting
the strip from the REST batch arm turned the REST tripwire red on exactly that
route; adding a *second* unstripped direct engine mouth turned it red again;
removing the new MCP strip turned the MCP tripwire red; every restore was proven
byte-identical with `git hash-object`.
