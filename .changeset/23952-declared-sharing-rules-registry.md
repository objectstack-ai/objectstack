---
'@objectstack/plugin-sharing': minor
'@objectstack/cli': minor
'@objectstack/lint': patch
---

feat(plugin-sharing,cli)!: declared sharing rules are read from the registry — the boot writes no `sys_sharing_rule` row for them, and the 17 → 18 ownership ceremony deletes the copies the retired seeder wrote

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) The retirement note for `bootstrapDeclaredSharingRules` (ADR-0131 D2, C3 stage 9): a runtime seeder and the rows it wrote, not a metadata schema. No key of any spec schema is removed, renamed or re-shaped — a stack's `sharingRules` author exactly as before — so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The seeder was never a public export. The rows it wrote are deleted by the organization-ownership ceremony (`os migrate organization-ownership --apply`), after it renames their grants. No ADR-0087 id covers this and this diff adds none. -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

`@objectstack/plugin-sharing` no longer copies a stack's declared `sharingRules` into `sys_sharing_rule` at boot. ADR-0131 D2 retires that seeder (`bootstrapDeclaredSharingRules`). The sharing-rule service reads each declared rule from the registry whenever it reads the rule set: listing, getting, evaluating, the per-record hooks, the boot backfill and the orphaned-grant sweep. Rules an organization authors keep their `sys_sharing_rule` rows.

- **A declared rule still grants, and stops granting when its declaration goes.** It is translated from the registry's copy exactly as the seeder translated it: the CEL `condition` is lowered to a `criteria` filter, and `sharedWith` becomes the recipient. A condition that does not lower is not served, and never as a match-all. It says so in one WARN line per rule per process. A declared rule's id is its NAME, and the grants it materialises carry the name as `sys_record_share.source_id`. Remove the declaration and the next boot's orphaned-grant sweep revokes those grants.
- **Scopes follow the posture, as the seeder's passes did.** Under `single` a declared rule is served once, organization-less, so every organization reads it. Under a wall it is served once per organization. An organization created after boot is served from its creation on. If the organizations cannot be read at boot, no declared rule is served until the next boot.
- **A stored row of the same name answers for it.** Under `single` that is a row of that name in any organization, and under a wall that organization's own row. Such a row is an organization's own rule, a seeded copy an administrator customized, or a seeded copy the ceremony has not deleted yet. The declared rule is not served beside it, the same as while the seeder ran: it never overwrote an admin-authored or customized row.
- **`DELETE /api/v1/sharing/rules/:idOrName` refuses a declared rule** with `403 PERMISSION_DENIED`. It has no row: it is changed or removed in its declaration. Before this release a platform administrator could delete the seeded row, and the next boot wrote it again. An organization's own rule is deleted as before.
- **Setup's Sharing Rules object list no longer shows declared rules.** It lists `sys_sharing_rule` rows. `GET /api/v1/sharing/rules` lists both.

`@objectstack/cli` — **`os migrate organization-ownership --apply` deletes the declared-rule mirrors.** The `declared-rule-mirrors` rows on `sys_sharing_rule` are the seeder's uncustomized copies (`managed_by` `package` or `platform`, `customized` not true). They now block certification until the ceremony's `mirror-deletion` step removes them. It works in the ruled order. It renames every grant naming a mirror by row id (`sys_record_share.source_id`, `source = 'rule'`) to the rule's name and verifies that no grant names a mirror any more. Only then does it delete the mirrors. Under a wall it deletes the organization-stamped copies too.
- A mirror whose rule no installed package declares, and that grants still name, blocks with nothing written. The blocker names the rows and the remedy. A mirror no grant names is deleted.
- The step also runs on a database whose ceremony already completed while an earlier release still seeded the rows, where they were advisory. Re-run `--apply` with a fresh plan.
- `DECLARED_SHARING_RULE_SEEDER_RUNS` is now `false`. A customized copy and an organization's own rule stay. Under `single` they take the Default Organization, as before.

`@objectstack/lint` — the sharing-rule enforceability verdicts and `os explain` say what now happens to a declared rule whose condition does not lower. It is "never served", not "never seeded", because it is never written to `sys_sharing_rule`. The rule ids, severities, paths and what each rule accepts or refuses are unchanged.
