---
'@objectstack/service-automation': patch
---

feat(automation): the flow credential channel reads and writes by package, so each slot of a flow name two packages hold reads its own package's credentials (ADR-0150 D8 row R9, part of #31696)

Clause-②: yes (widening)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or renamed. The credential reads widen (a shared slot's read is now answered), and the save refusal relaxes, so there is nothing for a migration to rewrite and no tombstone. -->

- `FlowCredentialChannel` now declares `readsByPackage = true`. Its index is keyed by flow name and package (`sys_flow_credential.flow_package`), so a credential read for a slot of a name two packages hold (an http node's signing secret, an inbound hook's secret) is answered by that package's rows only. It used to be refused. A row naming no package answers only a read that names none: under two holders it serves neither package.
- Each row the save door writes is stamped with the flow's one package holder. The plugin passes the engine's `flowHolderPackage` as the channel's new optional third constructor parameter (`holderOf`); existing two-argument callers keep compiling.
- Under a name two packages hold, a save or a publish reads, updates and deletes only the rows naming no package, so it never rewrites or removes a holder's credential. A save that sets a credential there, or clears one where a row of any package stands, is still refused with `RESOURCE_CONFLICT`, naming every holder. A save that drops a position no longer is (the holder's row stays), and a clear where no row stands still saves and writes nothing.
- A slot's run history is no longer cut short by another slot's newer runs of the same name: the store's window widens until the slot's own `limit` rows are in it or the store has no more.
- A stored run naming no package, written back while one package's slot holds a name the registry holds twice, keeps naming no package instead of being stamped with that slot's package.
