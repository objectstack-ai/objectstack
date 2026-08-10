---
"@objectstack/plugin-security": patch
---

ADR-0094 D5-R: retire the "customize packaged permission sets through an ADR-0005 env
overlay" direction (2026-07-14), and make the ADR text and the
`permission-set-projection.ts` header agree with what is enforced.

`#6483` (PR #6608) rolled `permission` back to `allowOrgOverride: false`, so a metadata
write against a **code-declared (artifact-backed)** permission set is refused with 403
`NOT_OVERRIDABLE` — ADR-0005's security row ("overlays would create silent privilege
drift") is enforced again. The supported channel for those sets is the one ADR-0086
always named: edit the package and re-publish. Environment authoring survives on the
`allowRuntimeCreate` tier, for sets whose definition lives only in `sys_metadata`
(data-door creations, and package sets authored + published through the metadata door);
that tier edits the single stored definition in place and is deliberately **not**
described as a re-route of the retired overlay channel.

No behaviour change: the four production write points keep their current dispositions.
The refusal is left to the producer — `plugin-security` does not re-derive
artifact-backing to pre-empt it — and the two write points that catch a failed metadata
write (the `restore` leg and the boot backfill) keep reporting on the durability channel.
What changes is prose, plus test coverage that can now see the gate: the suite's protocol
stub models ADR-0005's tier gate, so the four cases that pinned the retired direction no
longer pass for want of a stub that could refuse.
