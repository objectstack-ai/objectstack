---
"@objectstack/spec": patch
---

fix(spec): the RLS `using` / `check` texts say what the write gate enforces today — every row an insert or an update writes is checked, a check-only `update` policy is legal, and an `insert` policy's `using` is its check when none is declared (#19967)

Clause-②: no

Text only. No schema shape, accepted value or runtime behaviour changes.

- **`RowLevelSecurityPolicySchema.check`**: the describe and TSDoc said the check ran on the new row of a single-record insert or a by-id update, and that an array insert and a `multi: true` update were not post-image checked. Every insert and update shape is now judged: each row of an insert, an array insert included, as its `beforeInsert` hooks leave it, and each row an update changes, by id or `multi: true`, as the prior row merged with the final payload after its `beforeUpdate` hooks. One failing row refuses the whole write. A by-id update is also judged, before its hooks, on the change set as sent.
- **`RowLevelSecurityPolicySchema.using`**: the describe called it a filter for SELECT/UPDATE/DELETE and "optional for INSERT-only policies", and the TSDoc said UPDATE requires it. It now says, per operation, which rows it admits, that it stands in as the check on an insert or update when no applicable policy declares `check` (on an `insert` policy that is its only effect), that a `select` or `delete` policy needs it, and that an `insert`, `update` or `all` policy may declare `check` alone.
- **The "at least one of `using` or `check`" refusal**: its head is unchanged. It no longer says an UPDATE policy must provide `using` or that an INSERT policy must provide `check`. It names what each operation takes.
- **OR-combination**: the schema overview, the `priority` tombstone notes and the `os migrate meta --from 16` prose for the `priority` removal no longer say applicable policies OR-combine with "most permissive wins" without qualification. That holds on reads. On a write, the check is chosen per operation across the applicable policies first, and the chosen predicates then OR-combine.
- **Default deny**: the overview now limits "default deny" to the policies that apply. A caller to whom no policy applies is not restricted by the policies; the tenant wall still applies.
- The generated reference pages (`references/security/rls`, `references/security/permission`) and `docs/protocol-upgrade-guide.md` are regenerated from these sources.
