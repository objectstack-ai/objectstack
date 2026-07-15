---
'@objectstack/plugin-sharing': minor
'@objectstack/spec': patch
---

feat(plugin-sharing): sys_sharing_rule provenance + seed-not-clobber (#2909 P0/T1). The object gains readonly `managed_by` (unified A4 tri-state platform/package/admin) and `customized` columns; declared rules seed with `managed_by: 'package'`. defineRule in seed mode adopts pristine/legacy rows (package upgrades stay deliverable) but never overwrites admin-authored or customized rows — an admin's `active: false` on an over-sharing rule now survives redeploys instead of being resurrected at boot. A beforeUpdate hook stamps `customized` on any non-system edit of a seeded rule. Deliberately NO write gate: sharing rules remain a first-class admin authoring surface (ADR-0094 addendum tradeoff).
