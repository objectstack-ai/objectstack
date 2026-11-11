---
'@objectstack/service-automation': patch
---

feat(automation): the flow credential channel reads and writes by package, so each slot of a flow name two packages hold reads its own package's credentials (ADR-0150 D8 row R9, part of #31696)

Clause-②: yes (widening)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or renamed. The credential reads widen (a shared slot's read is now answered), and the save refusal relaxes, so there is nothing for a migration to rewrite and no tombstone. -->

- `FlowCredentialChannel` now declares `readsByPackage = true`. Its index is keyed by flow name and package (`sys_flow_credential.flow_package`), so a credential read for a slot of a name two packages hold (an http node's signing secret, an inbound hook's secret) is answered by that package's rows only. It used to be refused. Under two holders a row naming no package (one the boot backfill could not attribute, or one written before this release) belongs to no slot anyone can tell, so it fails closed for every slot: it reads as held, and its read is refused with `FlowCredentialUnresolvableError` (503) naming the flow, so an http node is refused and sends nothing rather than falling back to its literal or going unsigned.
- Each row the save door writes is stamped with the flow's one package holder. The plugin passes the engine's `flowHolderPackage` as the channel's new optional third constructor parameter (`holderOf`); existing two-argument callers keep compiling.
- Under a name two packages hold, a save or a publish never reads a holder's row, so it never rewrites or removes another package's credential. A save that sets a credential there, clears one where a row of any package stands, or would delete a row naming no package, and a publish that would promote, consume or remove a row naming no package, are refused with `RESOURCE_CONFLICT`, naming every holder, before anything is written. A save that drops a position where only a holder's row stands no longer is (that row stays), and a save that touches no row still saves.
- A slot's run history is no longer cut short by another slot's newer runs of the same name: the store's window widens until the slot's own `limit` rows are in it or the store has no more.
- A stored run naming no package, written back while one package's slot holds a name the registry holds twice, keeps naming no package instead of being stamped with that slot's package.
