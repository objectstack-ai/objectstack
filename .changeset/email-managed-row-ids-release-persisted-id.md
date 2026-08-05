---
"@objectstack/plugin-email": patch
---

fix(plugin-email): `send()` releases an insert-assigned row id from `managedRowIds` instead of leaking it (#5169)

`EmailPersistence.insert` is a **public** interface and may answer with an id of
its own — a database-assigned primary key, an external delivery system's receipt
id. `send()` reserves that id as service-managed too (so the `sys_email`
`afterInsert` outbox drain skips a row `send()` is already delivering), but its
`finally` only released the id `send()` had minted. The insert-assigned one was
reserved and never released.

Two consequences, both now fixed:

- **memory** — one leaked string per message in a `Set` that lives as long as the
  process;
- **semantics** — `isServiceManaged(persistedId)` stayed true forever. Ids are
  unique, so no other row was mistaken for a managed one, but that entry is a
  standing "this row belongs to a live `send()`" assertion which the drain hook
  and the boot outbox sweep (#5161) both trust and nothing ever re-checks: a row
  stranded at `queued` under such an id would be skipped by every future sweep.

The reservation window is unchanged — the release still happens in the same
`finally`, after inline delivery has finalized the row and after queue mode has
published the job, so nothing that relied on the row reading managed *during*
`send()` is affected. The in-repo persistence returns the id it was given
(ObjectQL echoes `row.id`), so no in-repo path ever reached the leaking branch;
this was reachable only by a custom `EmailPersistence` implementation.
