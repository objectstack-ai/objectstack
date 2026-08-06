---
'@objectstack/plugin-security': patch
---

**An admin-authored capability's `label`/`description` survive the boot (#5876).**

`bootstrapSystemCapabilities` seeds `sys_capability` in two halves: the CURATED
platform capabilities, and the back-compat DERIVED defaults — one row per
capability string a bootstrap permission set grants via `systemPermissions[]`
that nothing declared. Its seed loop refreshed `label`/`description` on whatever
row it found for a name, without looking at `managed_by`, while the comment
directly above it claimed the opposite ("do NOT clobber admin edits"). What
#2909 T3 actually made seed-once is `scope`, and only `scope`.

For a derived name there is no authored copy to reconcile: `label` is
`humanize(name)` and `description` is `Capability <name>.`, both generated from
the granted string. So an existing row's authored display fields were rewritten
to a humanized placeholder on **every boot**, whoever wrote them — silent data
loss, invisible from the outside.

Reachable, narrowly, and it needs the admin row to pre-exist the grant: an admin
creates capability `X` in Setup (`managed_by:'admin'` — the only provenance the
ADR-0066 write-guard leaves admin-writable), an app whose bootstrap permission
set grants `X` is installed, and every boot from then on renames it. The reverse
order is not reachable: once the derivation has created the
`managed_by:'platform'` placeholder, the write-guard stops the admin editing it
at all.

**The derived half now reconciles display fields only on rows it owns** —
`managed_by:'platform'` on a non-curated name, which can only be its own
placeholder from an earlier boot. `admin` rows, `package` rows and rows whose
provenance is missing are left exactly as their author wrote them, and counted
in the new `skippedAuthored` field of the seeding result (reported in the boot
summary, not warned about: nothing is degraded, the capability resolves and the
authored copy is the better one).

**The curated half is unchanged.** Those definitions are authored by the
platform and a new version legitimately ships new copy, so a curated name still
refreshes the row it finds. `scope` stays seed-once on both halves.

No migration and no authoring change: a placeholder that was already
overwritten is not restored (the previous text is gone), but it stops being
overwritten again, and an admin's re-edit now sticks.
