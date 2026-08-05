---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

fix(runtime): `callData`'s ObjectQL fallback answers a missing record id with 404 `RECORD_NOT_FOUND` (#5138)

`callData` (the data bridge behind `/data`, the MCP bridge and the declarative
endpoint executor) is protocol-first with an ObjectQL fallback. The fallback
gave **three different answers to one fact** — that `id` names no row:

| verb | before | on the wire |
|---|---|---|
| `get` | `return … : null` | `200 { data: null }` |
| `update` | `throw new Error('[ObjectStack] Not Found')` — no `.status` | **500** |
| `delete` | no existence check at all | `200 { deleted: true }` |

The protocol path has answered `404 RECORD_NOT_FOUND` on all three verbs since
#4435 (re-asserted for the batch path by #5088), so the answer to the same
request depended on something no caller can see: whether the deployment
registered the `protocol` slot (`MetadataPlugin` / `@objectstack/metadata-protocol`).
All three fallback branches now throw the SAME envelope the protocol throws.

Two of these were actively harmful. `update` reported a caller mistake as an
internal fault — every dispatcher exit reads `.status` → `.statusCode` → 500, so
a 4xx fact entered error reporting and alerting as a 5xx. `delete` reported
success for a row that never existed, which is the hardest class to notice: an
integrator reading `200` records the cleanup as done.

The envelope is not re-spelled. `recordNotFoundError` is now exported from
`@objectstack/metadata-protocol` and imported by the fallback, so there is one
construction point and the two paths behind one `callData` cannot drift apart
again.

**Upgrade note.** If you run an assembly WITHOUT the metadata-protocol plugin
(lean hosts, and the MCP multi-env path that threads a raw driver), these three
calls change their answer for a missing id — from `200`/`200`/`500` to `404
{ code: 'RECORD_NOT_FOUND', message: 'Record <id> not found in <object>' }`.
Deployments that DO register the protocol slot are unaffected: they already
answered `404` and this release does not touch that path. A client that
branched on `data === null` from `GET /data/:object/:id` should branch on the
`404` instead; a client that treated `DELETE` as idempotent should treat `404`
as "already gone". Declarative endpoints (`object_operation`) inherit the same
answer, since they reuse `/data`'s delegation.

`delete`'s existence check is a `find` probe, not a read of what `ql.delete`
returned: `IDataDriver.delete` declares `Promise< boolean >` and the protocol
can read it, but `IDataEngine.delete` declares `Promise< any >` and the engine
returns its driver's result through the hook chain — testing that for `false`
would be reading a signal the contract does not promise, and it fails in the
direction this fixes.
