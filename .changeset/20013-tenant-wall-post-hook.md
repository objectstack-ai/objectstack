---
"@objectstack/plugin-security": minor
---

fix(plugin-security)!: the Layer 0 tenant write wall now holds for the row a write stores, after the `beforeInsert` / `beforeUpdate` chain (#20013)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an enforcement change on the write gate: no authorable key, spelling or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. The remedy for a newly refused write is to change the hook or the data it derives the organization from. -->

**BREAKING**: this narrows the set of writes the write gate accepts. Under a walled tenancy posture (`isolated` or `group`), a write whose `beforeInsert` or `beforeUpdate` hook sets `organization_id` to an organization outside the caller's organization scope is now refused. It is admitted today, and the row is stored in that organization. It ships as `minor` under the launch-window convention, as the row-level `check` changes did (#19950, #19989).

The Layer 0 tenant wall (ADR-0095 D1, ADR-0105 D5) holds a write's `organization_id` to the same filter the read side uses, so a non-platform user can only place a row in an organization they hold. The wall judged the payload as the caller sent it, before the engine ran the hook chain. A value a hook wrote into `organization_id` after that point was never judged, whether the hook derived it from another field, a parent record or a lookup.

The wall now also judges the row the engine is about to store, through the seam the row-level `check` already uses (`OperationContext.postHookWriteImageCheck`): an insert's rows once the `beforeInsert` chain has run (every row of an array insert), the one row of a by-id update, and every matched row of a predicate update, each merged with the final payload. It is installed whenever the wall applies to the write, with or without a business `check`. The existing judgement of the payload as sent stays, so this change only ever refuses more.

**Writes that are now refused.** Each refusal is the wall's existing denial, `403 PERMISSION_DENIED` ("the insert/update would place '…' in another tenant"), and nothing is stored. There is no transition switch.

- **An insert, a by-id update or a predicate update whose hook chain leaves `organization_id` outside the caller's organization scope**: another organization under `isolated`, one outside the membership set under `group`. For an on-behalf-of write the delegator's scope applies too (ADR-0090 D10).
- **A walled write on a host that installs the judgement and never runs it**, for example a custom write executor in place of the engine. It is refused after the write with an `error` log saying the tenant wall was not evaluated on the stored row, as a write with an uncalled row-level `check` already is. The platform's own permission-set data door (ADR-0094), which executes its writes without the engine and so runs no hook chain, is not affected.

**Remedy.** A hook that must place a row in another organization does so in a separate write under a system context, which the wall does not gate. Otherwise fix the hook, or the data it derives the organization from, so the stored row stays in the caller's organization scope.

**What does not change.**

- A write whose hooks leave `organization_id` in the caller's scope, or leave it alone, is admitted as before. An update that does not touch the column keeps the row's current organization.
- An insert that leaves `organization_id` absent is not judged on it: the platform fills it with the caller's active organization, as before.
- A supplied out-of-scope `organization_id` is refused before anything runs, as before, even when a hook would replace it with an in-scope one.
- A system-context write, a platform administrator on an object whose posture lets them cross the wall, and every write under the `single` posture are not gated by the wall, as before.
