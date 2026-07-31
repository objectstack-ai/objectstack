---
"@objectstack/lint": patch
---

feat(lint): `flow-node-write-unknown-field` covers `create_record` too (#4271)

#4369 shipped the flow write-set gate on `update_record` alone and parked
`create_record` in `FLOW_WRITE_NODE_TYPES_DEFERRED` with its reason — a gating
rule earning its severity one measured surface at a time, recorded as data
rather than left as silence. This measures the other half and moves it across.

**The INSERT path fails the same way, one notch harder.** Same literal
`config.fields` map, same `objectName` binding, same journey to the driver — the
engine hands an undeclared key to `driver.create` verbatim, alongside the audit
stamps. On SQLite/knex it becomes `table deal has no column named stagee` and
the statement is rejected whole, so the correctly named fields in the same
payload never land either. The extra harm is what does *not* exist afterwards:
the row is never created, so every later node reading `{<node>.id}` from that
node's `outputVariable` is working from a record that was never written. An
`update_record` failure at least leaves the record intact.

So the message now names that consequence on `create_record` and only there —
"…and the record is never created at all" — instead of one sentence blurred to
fit both.

Nothing else moves: same rule id, same `error` severity, the same silent bails
(templated `objectName`, non-literal `fields`, cross-package objects, objects
declaring no fields, dotted keys), and `runAs` is still not consulted. Each skip
is now pinned on the create surface as well as the update one, so the two node
types cannot drift into different behaviour.

**`FLOW_WRITE_NODE_TYPES_DEFERRED` is now empty and deliberately kept.** The
partition test derives the full `fields`-write-map set behaviourally from the
spec's executor-written config schemas, so a node type that grows one later
belongs to neither list and fails that test until someone classifies it.
Deleting the empty array would turn that forced decision back into a default.

Two non-members are now excluded on the shape of their failure rather than by
omission, both stated in the module header and one pinned by a test:
`get_record.fields` is a projection (`z.array(z.string())`) — a READ, where an
unknown entry narrows the selection instead of breaking the statement — and
`screen.defaults` is forwarded into the `ScreenSpec` the client renders, so an
unknown key is a prefill the renderer ignores. That inert "skips it and renders
the rest" case is exactly what this rule's `error` severity is defined against.

Verified against the repo's own apps: app-crm, app-todo and app-showcase all
still validate clean with `create_record` covered — including crm's
convert-lead flow, which creates an account and an opportunity before updating
the lead.
