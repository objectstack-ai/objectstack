---
"@objectstack/plugin-security": minor
---

A boot report lists, per organization, every security catalog reference whose name resolves nowhere (ADR-0131 D3/D4)

Clause-②: no

ADR-0131 D4 makes every reference to a position or a permission set a name, resolved through the security catalog (the environment registry). A stored reference whose name the catalog does not hold confers nothing, while Setup still lists it. At every boot, at `kernel:bootstrapped` and after the two one-time backfills, `@objectstack/plugin-security` now reads the stored references and logs what the catalog does not resolve. The report writes nothing: no row, no definition, no ledger entry.

- **Where to read it.** In the boot log, as `[security]` lines at `error`, one line per kind of finding. Each line's metadata lists the organizations (`organizationId`, `null` for organization-less rows) with a count and the names or row ids, at most 50 per list. A clean boot logs one `info` line that says every reference resolves.
- **What it lists, per organization:**
  - `sys_user_position` assignments whose `position` the catalog does not resolve;
  - `sys_user_permission_set` grants whose `permission_set` the catalog does not resolve;
  - `sys_user_permission_set` grants with no `permission_set` at all. The one-time name backfill could not name them: the set row is missing, belongs to another organization, or carries a name the catalog does not resolve (a row-only set). An unnamed grant confers nothing;
  - `sys_position` rows whose name the catalog does not resolve, by name and organization. Under a walled posture these are the positions an organization authored in Setup: the catalog is environment-level, so they have no catalog home, and their assignments distribute no permission set. Under `single` these are the row-only positions the row-only backfill could not define, with `refusedNames` naming the ones whose names the metadata door refuses. The backfill reports that class once and records its verdict; this report lists it at every boot.
- **And under `single` only:** position names carried by more than one `sys_position` row (two organizations' rows, or an organization's row beside a package's or a built-in's seeded row). A position name is unique per deployment under `single`, so each is reported as conflicting, never guessed and never merged.
- **What clears a line.** The next boot re-reads everything. A reference whose definition is declared again (its package or its environment definition) leaves the report. So does a walled organization's position once a definition of that name is saved through the metadata door. Otherwise remove the row, or re-point it at a name the catalog holds.
- **A read that did not happen is not a finding.** If a scan or the catalog read fails, the report says which store it could not read, at `warn`, and reports nothing for that boot.
- **The grant-name backfill's warnings now say what such a grant is worth.** A grant the backfill could not name, because its set row's name is not in the catalog or its name write did not land, confers nothing until a later boot names it. The warning used to say these grants still resolved by id. That stopped being true when the authorization resolver began reading grants by name.
- **Nothing to migrate.** No configuration is needed.
