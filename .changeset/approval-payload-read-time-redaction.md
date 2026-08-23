---
"@objectstack/plugin-approvals": patch
---

Apply the subject object's field-level read controls to the approval payload
snapshot at serve time (#10749), so an approver no longer receives fields the
app author declared they may not read.

`sys_approval_request.payload_json` stores the submitted record's raw row,
captured from the flow's `$record` variable — which the automation layer hands
over with the record's own FLS never applying. The column is a `textarea` on
`sys_approval_request`, so to every read door it is an opaque string: the
field-visibility machinery governs *columns of objects* and cannot see inside a
JSON column. Every field-level read control declared on the SUBJECT object —
`requiredPermissions` (ADR-0066 D3), a permission set marking a field
non-readable, a `maskingRule` — was therefore unenforceable on the approval
path, for every app.

Per the maintainer's ruling (2026-08-22, Option B) the full snapshot **stays at
rest**: the approval record remains audit evidence of what was actually
submitted, which write-time trimming would have given away. Redaction happens at
**serve** time, keyed on the reading caller, so the same row answers an admin
with the whole snapshot and a restricted approver with only the fields they may
read. The readable set is not recomputed — it comes from the security service's
`getReadableFields`, documented as the same field mask the read middleware
applies, so this seam cannot drift from data-plane FLS.

Two doors are covered, because `payload_json` has two independent readers and a
seam covering one manufactures the belief that the path is masked:

- the **service door** (`getRequest` / `listRequests`, behind
  `GET /api/v1/approvals/requests[/:id]`), which serves the parsed `payload`.
  Redaction runs BEFORE display enrichment, so `payload_display` and
  `payload_labels` — both built by walking the snapshot's own keys — cannot ship
  a restricted field's name, its authored label, or the title of the record it
  points at;
- the **generic data door**: the object declares
  `enable.apiMethods: ['get','list']`, so a plain `find`/`findOne` returns the
  raw string without the service ever running. Covered by object-scoped engine
  middleware, which reaches the whole family sharing that producer (REST data
  routes, ObjectQL, CSV/XLSX export, MCP). Middleware rather than an `afterFind`
  hook on purpose: a hook receives `buildSession`'s output, which carries no
  `onBehalfOf`, so a hook-based seam would drop the ADR-0090 D10 delegator
  intersection and answer a delegated read more permissively than the service.

**Behaviour change, argued rather than assumed.** A non-admin caller that was
reading restricted keys out of the snapshot now receives fewer keys, and that is
a real change for such a consumer. It is shipped as a fix rather than a breaking
change because those fields were never that caller's to read: the approval path
was a bypass of a declaration the platform enforces everywhere else, and the
served type is `payload?: unknown` — never a promised field set. This follows the
`__search` companion strip (#7642), which shipped the same way on the same
reasoning. Object-level access is deliberately untouched: an approver commonly
holds no read grant on the object under approval at all, and
`getReadableFields` answers a caller with no field-permission entries with the
full set, so every approval drawer shipping today keeps rendering.

`hidden: true` is deliberately NOT acted on. It is a UI contract ("Hidden from
default UI") which, in the spec's own words, "has never governed serialization"
— measurably: no read path in the repo strips a value on it. Enforcing it here
alone would make the approval path stricter than a direct read of the same row
(closing no leak, since the approver can simply read the record) while breaking
drawers that render a `hidden` business column. That is a `packages/spec`
semantics question and is left open.
