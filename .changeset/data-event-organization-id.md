---
"@objectstack/spec": minor
---

feat(spec): `DataEvent` names the organization the record belongs to, so a tenant-scoped consumer can tell whose event it is

The realtime `DataEvent` payload (`@objectstack/spec/api`, the body of every
`data.record.created` / `data.record.updated` / `data.record.deleted` event)
gains an optional `organizationId`: the organization the record belongs to.
Until now the event carried the object name, the record id and the row body,
and nothing that named the tenant — so a consumer that fans events out per
organization (a webhook subscription, a per-organization realtime subscriber)
had no term to discriminate on short of reading the row body, which is absent
on delete events and is not the consumer's to read.

What a consumer may assume:

- **Present** — exactly that organization, never a guess: the organization the
  record belongs to, not the caller's active organization standing in for it.
- **Absent** — the record belongs to no organization. That is every event on a
  `single`-posture deployment (no organization wall, nothing stamps the
  column) and an organization-less, environment-wide row under a walled
  posture. Read it as "not behind any organization wall", never as "unknown,
  look it up".

Declared = enforced: the key is optional and nothing else. No default
fabricates a tenant; `null` and the empty string are refused with a located
issue, so "no organization" has exactly one spelling — the key is absent.

Additive and shape-preserving: every event that parsed before parses
identically, and no producer emits the key yet — the ObjectQL engine's publish
site is a separate change that follows this contract. The bulk
`BulkDataEvent` (`data.records.*`) is deliberately untouched: a predicate
write's affected set is its own contract with its own tenant question.
