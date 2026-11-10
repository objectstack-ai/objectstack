---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
'@objectstack/driver-mongodb': patch
'@objectstack/driver-sql': patch
---

feat(plugin-security, runtime, metadata-protocol, core)!: the permission-set grant, clone and activation doors take a package, and a grant is unique per package (#32164)

Clause-②: no — a widening at the doors, plus declared narrowings: a named package that does not hold the set is refused at any holder count (F3), the clone and activation doors' query sets are closed, and a clone target name two packages hold is taken.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped. `sys_user_permission_set` is a platform object and its `indexes[]` is not authored metadata; the index change is a schema face that the drift plan and a runtime guard apply, and no stored row is rewritten. What moves is the answer a request gets at three doors, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for a writer that sends `permission_set_package` naming a package that does not hold the permission set, and for a request to either permission-set door that carries a query parameter. No first-party writer sends either: the boot backfill and `os migrate stored-references bind` write only a holder, and the Console sends no query to these doors.

ADR-0150 D3/D5/D8, child of #31527. A permission set is identified by `(package, name)` (D4). Until #31698 PR-2 a real registry cannot hold two packages' sets of one name, so every two-holder answer below is reachable only after that; every one-holder answer is unchanged, except the three narrowings declared above.

**The grant: `sys_user_permission_set` through the engine and `/data`.**

- A set two packages hold, named with no package, at the data door (a non-system writer): FROM `400 VALIDATION_FAILED`, `reference_not_found` at `permission_set` ("There is no permission set named …") TO `409 RESOURCE_CONFLICT` with the D3 sentence naming every holder. The thrown error is core's `PackageScopedNameRefusedError` (`.refusal.candidates` structured). The `/data` body carries the sentence; structured candidates on `/data` are #32250. Nothing is stored.
- The same, naming a holder in `permission_set_package`: FROM the same `400` (non-system) or stored with no package (system) TO stored with exactly that package.
- Naming a package that does not hold the set (F3), at any holder count, for any writer: FROM stored with the seam's answer (one holder: re-stamped to the holder; two holders: no package) TO `409 RESOURCE_CONFLICT`, reason `not-held-by-qualifier`, naming the holders (an environment-authored set names the environment). Nothing is stored.
- A system update writing `permission_set_package` alone (a column-only bind): naming a holder, unchanged (lands as written). Naming a non-holder: FROM landed as written TO `409 not-held-by-qualifier`, the row unchanged.
- A system insert naming a package before the boot seals the holders: FROM the package replaced by none TO the package kept unjudged (the boot backfill reads a stale one as no package).
- Unchanged: a name nothing holds is the `400` it was, with or without a package; a set one package holds, named with no package or with its holder, is stored stamped with that holder; a non-system update's `permission_set_package` is still dropped by the engine's `readonly` update strip, never stored and never judged; an echo of the stored package chooses nothing; a rename re-stamps as before.

**The activation door: `POST /security/_activation/permission/:name`.**

- A set two packages hold, no package named: FROM `404 RESOURCE_NOT_FOUND` ("… has no definition — there is nothing to switch off") TO `409 RESOURCE_CONFLICT`, the D3 sentence, `details.candidates: [{ kind: 'package', packageId }, …]`. Nothing is written.
- `?package=PKG`, a holder: FROM the query dropped (the same `404`) TO exactly PKG's set switched, its ledger row naming PKG. The ledger store still keeps one row per `(metadata_type, name)` (ADR-0150 red line 3), because every reader of a permission set's row is name-keyed, so a later flip naming the other holder re-addresses that row; per-package rows need package-keyed ledger readers, which this change does not touch.
- `?package=PKG`, a non-holder: FROM the query dropped (one holder: `200` on the holder's set) TO `409 not-held-by-qualifier` naming the holders. Nothing is written.
- Any other query parameter, on any type, and a repeated or blank `package`: FROM dropped without a word TO `400 VALIDATION_ERROR` (AGENTS route rule 5) before any lookup. The closed set is `package` for `permission` and nothing for every other type.
- The body stays `{ enabled? }`: a `package` key in the body is still `400 unknown_field`.

**The clone door: `POST /security/permission-sets/:name/clone`.**

- A source two packages hold, no package named: FROM `404 RESOURCE_NOT_FOUND` ("… there is nothing to clone") TO `409 RESOURCE_CONFLICT` with `details.candidates`. Nothing is saved.
- `?package=PKG` names the SOURCE's package (the body's `package` still names where the copy lands): FROM the query dropped TO exactly PKG's set copied, landing by the existing rule (a read-only package's copy lands in its pair). A non-holder is `409 not-held-by-qualifier`.
- A target name two packages hold: FROM not taken (the reader's by-name read answers nothing for a refused name), so the copy was saved TO `409`, taken, as a name one package holds already was. Nothing is saved.
- Any other query parameter, and a repeated or blank `package`: FROM dropped TO `400 VALIDATION_ERROR`, before the body and any lookup.

**In-process APIs.**

- `@objectstack/core`: the refused arm of `SecurityCatalogResolution` (what `resolveCatalogReference` and `SecurityCatalogReader.resolveReference` answer) gains an optional `holders: readonly PackageScopedHolder[]`, the candidates structured, in the same order as `candidates`. FROM absent TO present on every refusal the reader answers. Additive: a resolved or not-found answer has none, and an implementer of the type may omit it.
- `@objectstack/metadata-protocol` exports `ensureUserPermissionSetPackagelessIndex`, `buildUserPermissionSetPackagelessIndexSql`, `buildUserPermissionSetPackagelessDuplicateProbeSql`, `resolveUserPermissionSetIndexSeam`, `USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME` and the result and status types. Additive.

**The grant's unique key (schema face, every driver).**

- FROM `(user_id, permission_set, organization_id)`, `unique: 'organization'` TO `(user_id, permission_set, permission_set_package, organization_id)`, `unique: 'global'`: one user may hold both packages' sets of one name in one organization, and one package's set twice is refused.
- A grant naming no package (a NULL `permission_set_package`) is exempt from that key, so a runtime guard keeps those to one per `(user_id, permission_set, organization_id)`: `uniq_sys_user_permission_set_packageless`. On SQL, `metadata-protocol` builds it at `kernel:ready` (a partial index on SQLite and PostgreSQL, a functional key part on MySQL 8.0.13+, an INVISIBLE generated `__hash` column on MariaDB 10.3+). On Mongo, `driver-mongodb` builds it at collection sync (`RUNTIME_OWNED_UNIQUES`, `permission_set_package: null`). Nothing the old key refused is admitted, measured per dialect with a non-null and a NULL organization (the old key's plain key parts exempted a NULL organization too; where an 18.0 database built it in the NULL-safe COALESCE form, it is retired only on a certified table, whose tenant column holds no NULL, and kept everywhere else, see the `driver-sql` item below; a table `driver-sql` builds has a NOT NULL organization column).
- The guard is re-runnable and guesses no package. If existing grants already violate it, the build fails and logs, at `error`, the duplicated keys, the consequence and the listing query; no grant is deleted or re-stamped, and the next boot tries again. `os migrate duplicates` now lists six `kernel:ready` indexes, this one among them.
- Upgrading: the old three-column index retires only once the guard stands. On SQL that is the next sync that runs safe drift (dev `autoMigrate: 'safe'`, or `os migrate apply`) as one `replace_unique_index`, categorized `safe`. Until then it keeps refusing what it refused. On Mongo it retires in the same sync that builds the guard.
- `@objectstack/driver-sql`, the differ's widening arm (the rule that retires a narrower unique a declared global key superseded), for any declared key that gains columns:
  - The narrower key as an 18.0 database built it, with its organization key part in the NULL-safe form (`COALESCE(organization_id, '__global__')`, under the same generated name): FROM an orphan, `drop_index` categorized `destructive` TO the widening arm's. On a certified table (ADR-0131 D1: the tenant column holds no NULL) it is kept until the guard stands and then offered as the one `safe` replace. On a table that is not certified it is kept and nothing is offered, because the COALESCE form also keeps NULL-organization rows to one, which neither the wider key nor the guard does.
  - A plan read before the sync that adds a gained column (`os migrate plan` over an upgraded database): FROM the narrower index an orphan, `destructive` TO kept, nothing offered.
  - Unchanged: a plain narrower is matched as before, and a hash-shadow-carried one (MySQL, MariaDB) is still not matched by this arm.
- Declared limit: `driver-memory` builds no guard (no raw-SQL seam; the activation ledger's guard has the same exemption). Measured: its unique check treats a NULL as distinct, so it admits two package-less grants of one set for one user in one organization, where the old key refused the second. A pin asserts that admission (`memory-user-permission-set-packageless.test.ts`).
