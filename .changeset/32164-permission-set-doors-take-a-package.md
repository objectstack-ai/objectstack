---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/runtime': patch
---

feat(plugin-security, runtime, core)!: the permission-set grant, clone and activation doors take a package, and a grant is unique per package (#32164)

Clause-②: no (narrowing)
- Widening, at the grant, clone and activation doors: a permission set two packages hold, addressed with no package: FROM read as absent (the grant's `400 reference_not_found`, the clone and activation doors' `404`) TO `409 RESOURCE_CONFLICT` naming the holders; addressed with a package that holds it (`permission_set_package` on the grant, `?package=` on clone and activation): FROM the package dropped TO exactly that package's set.
- Widening, the grant's unique key: FROM one grant per `(user_id, permission_set, organization_id)` TO one per `(user_id, permission_set, permission_set_package, organization_id)`, so one user may hold both packages' sets of one name in one organization. A grant naming no package stays one per `(user_id, permission_set, organization_id)` through the guard the preceding PR builds, except on `driver-memory` (declared below).
- Narrowing (F3), a named package that does not hold the set, at any holder count: FROM the grant or audience-binding suggestion re-stamped to the holder (one holder) or stored with no package (two holders), a system column-only bind landing as written, and `?package=` dropped at the clone and activation doors (one holder: the holder's set) TO `409 RESOURCE_CONFLICT`, reason `not-held-by-qualifier`, naming the holders, with nothing stored or switched.
- Narrowing, the query sets are closed: FROM any query parameter dropped without a word TO `400 VALIDATION_ERROR` before any lookup, at the clone door and at the activation door for all six of its types (`position`, `permission`, `sharing_rule`, `webhook`, `queue`, `assignment_rule`), for anything but `package` on `permission`, and for a repeated or blank `package`.
- Narrowing, a clone target name two packages hold: FROM free (the reader answers nothing for a refused name, so the copy was saved) TO taken, `409`, as a name one package holds already was.
- Narrowing, the activation ledger for a permission set two packages hold: switching a holder on while a ledger row naming no package, or naming a package that no longer serves the name, keeps it off: FROM (reachable only after #31698 PR-2) that row re-addressed to the holder, which re-armed the other holder too TO `409 RESOURCE_CONFLICT` naming that row, nothing written (ADR-0150 red line 1). The same with one holder when the name has more than one row, which no first-party writer makes.

Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped. `sys_user_permission_set` is a platform object and its `indexes[]` is not authored metadata; the index change is a schema face that the drift plan applies, and no stored row is rewritten. What moves is the answer a request gets at three doors, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for a writer that sends `permission_set_package` naming a package that does not hold the permission set, and for a request carrying a query parameter to the clone door or to the activation door, for any of its six types. No first-party writer sends either: the boot backfill and `os migrate stored-references bind` write only a holder, and the Console sends no query to these doors.

ADR-0150 D3/D4/D5/D8, child of #31527. The last of three PRs for #32164: the first taught `driver-sql`'s widening arm the superseded grant key's 18.0, shadow-carried and not-yet-physical forms; the second builds the grant's package-less guard at schema sync and lists it in `os migrate duplicates`. A permission set is identified by `(package, name)` (D4). Until #31698 PR-2 a real registry cannot hold two packages' sets of one name, so every two-holder answer below is reachable only after that; every one-holder answer is unchanged, except the narrowings declared above.

**The grant: `sys_user_permission_set` through the engine and `/data`.**

- A set two packages hold, named with no package, at the data door (a non-system writer): FROM `400 VALIDATION_FAILED`, `reference_not_found` at `permission_set` ("There is no permission set named …") TO `409 RESOURCE_CONFLICT` with the D3 sentence naming every holder. The thrown error is core's `PackageScopedNameRefusedError` (`.refusal.candidates` structured). The `/data` body carries the sentence; structured candidates on `/data` are #32250. Nothing is stored.
- The same, naming a holder in `permission_set_package`: FROM the same `400` (non-system) or stored with no package (system) TO stored with exactly that package.
- Naming a package that does not hold the set (F3), at any holder count, for any writer: FROM stored with the seam's answer (one holder: re-stamped to the holder; two holders: no package) TO `409 RESOURCE_CONFLICT`, reason `not-held-by-qualifier`, naming the holders (an environment-authored set names the environment). Nothing is stored.
- A system update writing `permission_set_package` alone (a column-only bind): naming a holder, unchanged (lands as written). Naming a non-holder: FROM landed as written TO `409 not-held-by-qualifier`, the row unchanged.
- A system insert naming a package for a name nothing holds: FROM the package replaced by none TO kept as written. There is no holder to refuse it against, and every reader reads a package that does not serve the name as no package, so it confers nothing.
- A system insert naming a package before the boot seals the holders: FROM the package replaced by none TO kept unjudged (the boot backfill reads a stale one as no package).
- Unchanged: a name nothing holds is the `400` it was for a non-system writer, with or without a package; a set one package holds, named with no package or with its holder, is stored stamped with that holder; a non-system update's `permission_set_package` is still dropped by the engine's `readonly` update strip, never stored and never judged; an echo of the stored package chooses nothing; a rename re-stamps as before.

**The audience-binding suggestion: `sys_audience_binding_suggestion` (R3).** The same stamp serves its `permission_set_package`, asked from the suggestion's own `package_id`. The table is system-write only, and `os migrate stored-references bind --table sys_audience_binding_suggestion` writes through the stamp.

- A system insert naming a package that does not hold the set: FROM re-stamped by the rule's answer TO `409 RESOURCE_CONFLICT`, `not-held-by-qualifier`. Nothing is stored.
- A system update writing `permission_set_package` alone, naming a non-holder: FROM landed as written TO the same `409`, the row unchanged.
- A system insert naming one of two holders in the suggester's reach: FROM no package (the rule refuses the bare name) TO kept as written.

**The activation door: `POST /security/_activation/:type/:name`.**

- A permission set two packages hold, no package named: FROM `404 RESOURCE_NOT_FOUND` ("… has no definition — there is nothing to switch off") TO `409 RESOURCE_CONFLICT`, the D3 sentence, `details.candidates: [{ kind: 'package', packageId }, …]`. Nothing is written.
- `?package=PKG`, a holder: FROM the query dropped (the same `404`) TO exactly PKG's set switched, through PKG's own ledger row. The permission ledger is now addressed by `(package, name)`, the ledger's declared key: each holder keeps its own row, so switching one holder's set never touches the other's, and both stay independently switchable. The readers already read each row by its package (a row naming no package, or naming one that no longer serves the name, is read by the name alone, ADR-0150 D3: with two holders it switches both off). Every other type keeps the name-addressed store.
- Switching a holder on while a row naming no package, or naming a package that no longer serves the name, keeps it off (two holders): `409 RESOURCE_CONFLICT` naming that row, nothing written. Switching it off writes the holder's own row and leaves that row as it is. With one holder, such a row, when it is the name's only row, is the holder's and the write takes it over, as before. With one holder and more than one row for the name (no first-party writer makes one: the name-addressed store kept one row per name), switching on while another row keeps it off: FROM the first row found re-addressed TO the same `409`.
- A write that would re-address a row switched off for another holder is refused `409`, nothing written. The address rule above never picks one; the refusal stands against a concurrent write or a later reader change.
- `?package=PKG`, a non-holder: FROM the query dropped (one holder: `200` on the holder's set) TO `409 not-held-by-qualifier` naming the holders. Nothing is written.
- Any other query parameter, on any of the six types, and a repeated or blank `package`: FROM dropped without a word TO `400 VALIDATION_ERROR` (AGENTS route rule 5) before any lookup. The closed set is `package` for `permission` and nothing for every other type.
- The body stays `{ enabled? }`: a `package` key in the body is still `400 unknown_field`.

**The clone door: `POST /security/permission-sets/:name/clone`.**

- A source two packages hold, no package named: FROM `404 RESOURCE_NOT_FOUND` ("… there is nothing to clone") TO `409 RESOURCE_CONFLICT` with `details.candidates`. Nothing is saved.
- `?package=PKG` names the SOURCE's package (the body's `package` still names where the copy lands): FROM the query dropped TO exactly PKG's set copied, landing by the existing rule (a read-only package's copy lands in its pair). A non-holder is `409 not-held-by-qualifier`.
- A target name two packages hold: FROM not taken (the reader's by-name read answers nothing for a refused name), so the copy was saved TO `409`, taken, as a name one package holds already was. Nothing is saved.
- Any other query parameter, and a repeated or blank `package`: FROM dropped TO `400 VALIDATION_ERROR`, before the body and any lookup.

**The grant's unique key (schema face, every driver).**

- FROM `(user_id, permission_set, organization_id)`, `unique: 'organization'` TO `(user_id, permission_set, permission_set_package, organization_id)`, `unique: 'global'`: one user may hold both packages' sets of one name in one organization, and one package's set twice is refused.
- A grant naming no package (a NULL `permission_set_package`) is exempt from that key; the guard `uniq_sys_user_permission_set_packageless` keeps those to one per `(user_id, permission_set, organization_id)` (built at schema sync by the preceding PR). Nothing the old key refused is admitted, with a non-null and with a NULL organization: measured on SQLite and PostgreSQL 16, and pinned for MySQL, MariaDB and a real mongod in suites that run on `main` only, so those first run after this lands. The old key's plain key parts exempted a NULL organization too; a table `driver-sql` builds has a NOT NULL organization column.
- Upgrading: the old three-column index retires only once the guard stands. On SQL that is the next sync that runs safe drift (dev `autoMigrate: 'safe'`, or `os migrate apply`) as one `replace_unique_index`, categorized `safe`; until then it keeps refusing what it refused. Where an 18.0 database built it in the NULL-safe COALESCE form, it is retired only on a certified table, whose tenant column holds no NULL, and kept everywhere else. On Mongo it retires in the same sync that builds the guard. A server with no form for the guard (MySQL before 8.0.13, MariaDB before 10.3) keeps the old key, as the preceding PR declares.
- Declared limit: `driver-memory` builds no guard (no raw-SQL seam; the activation ledger's guard has the same exemption). Measured: its unique check treats a NULL as distinct, so it admits two package-less grants of one set for one user in one organization, where the old key refused the second. A pin asserts that admission (`memory-user-permission-set-packageless.test.ts`).

**In-process APIs.**

- `@objectstack/core`: the refused arm of `SecurityCatalogResolution` (what `resolveCatalogReference` and `SecurityCatalogReader.resolveReference` answer) gains an optional `holders: readonly PackageScopedHolder[]`, the candidates structured, in the same order as `candidates`. FROM absent TO present on every refusal the reader answers. Additive: a resolved or not-found answer has none, and an implementer of the type may omit it.
