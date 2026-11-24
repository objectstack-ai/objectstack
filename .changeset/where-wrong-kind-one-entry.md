---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

fix(spec)!: a query `where` of the wrong kind is refused with one `fields[]` entry that names the shapes it takes, not one bare "Invalid input" per union member

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none (no skills/ page names the `query.where` refusal, its `Invalid input` entries, or reads `fields[]` / `issues[]` by position or count)

What narrows: the union-branch selection that every refusal list shares now reads a member that is itself a union, failing only because the value is the wrong kind for every one of its own members, as the kind mismatch it is. Such a member is no longer selected, so it no longer adds its own unexplained `invalid_shape` / `Invalid input` entry. The rule lives in `@objectstack/spec`'s branch-selection policy, so the data API's `fields[]` (`zodIssuesToFields`) and the terminal renderer (`formatZodError`) both take it, and `@objectstack/metadata-protocol`'s copy for a refused metadata save's `issues[]` takes the same rule, pinned equal by the cross-package parity test. A nested union declared with its own `error` sentence is still selected, because that sentence is a prescription.

The query door's `where` (and its `$filter` / `filter` / `filters` spellings) is such a union of unions: a filter array or a filter object. A number, a string, a boolean or `null` there now carries one sentence naming both accepted shapes, a condition object such as `{ "status": "open" }` or a filter array such as `["status", "=", "open"]`. An array or an object still answers its located causes.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moves is which entries a refusal's fields and issues lists carry, and the message of one of them, computed afresh on every refused request. The accept set is unchanged. The one reading instruction is in the body: read entries by field and code, never by index or count. -->

**BREAKING** for a client that counts a refused request's `fields[]` entries, reads them by position, or matches the bare `Invalid input` text on the `query.where` entry. Those duplicate entries named only the slot, once per union member, and said nothing about what to send. Read entries by `field` and `code`.

For `POST /api/v1/data/:object/query` with `{ "where": 42 }` (a string, a boolean or `null` alike):

- FROM: `fields` was `[{ field: 'query.where', code: 'invalid_shape', message: 'Invalid input' }, { field: 'query.where', code: 'invalid_shape', message: 'Invalid input' }]`.
- TO: `fields` is `[{ field: 'query.where', code: 'invalid_shape', message: 'A filter is a condition object, such as { "status": "open" } … or a filter array, such as ["status", "=", "open"] …' }]`.

For `{ "where": [["status", "=", "open"], "and"] }`:

- FROM: `fields` held `min_items` at `query.where`, a bare `invalid_shape` at `query.where.1`, and a second bare `invalid_shape` at `query.where`.
- TO: `fields` holds `min_items` at `query.where` and the bare `invalid_shape` at `query.where.1`, the element that is not a filter.

The fix for a caller that matched the bare text on `query.where`: match `field: 'query.where'` with `code: 'invalid_shape'`, whatever the message.

A refused metadata save (`422 INVALID_METADATA`) moves the same way, only where its schema has such a nested union of kinds: one `invalid_union` entry for the slot instead of one per member.
