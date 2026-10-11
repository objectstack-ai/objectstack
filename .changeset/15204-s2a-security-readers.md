---
'@objectstack/core': minor
'@objectstack/plugin-security': minor
---

feat(plugin-security)!: the security plugin's own readers (set resolution, the delegated-administration gate, the permission explainer and the position-assignment refusal) read the security catalog and the activation ledger, not the catalog rows (ADR-0131 D3/D4)

Clause-②: yes

<!-- adr-0087: not-required (already-registered position-permission-sets-declared) stage 1 registered this cutover: row-only catalog items confer nothing, and this changeset carries that rule to the security plugin's own readers -->

**BREAKING** (enforcement stops reading `sys_permission_set` rows), shipped as `minor` under the launch-window convention for breaking changes. This is the second step of the cutover that `position-permission-sets-declared` registers: the authorization resolver already reads the catalog; now the security plugin's readers read the same catalog.

**Permission-set resolution (`@objectstack/plugin-security`).**

- FROM: a set name the metadata service and the bootstrap sets did not answer was loaded from a `sys_permission_set` row (the caller's organization's, else an organization-less one), its object map and field map included, and dropped when the row's `active` was false.
- TO: it is loaded from the security catalog (the environment registry the security plugin binds to its engine): every package's sets and every set an author saved through the metadata door. A set that only a row carries resolves nothing. The resolver already granted nothing through such a set; now its object and field permissions stop applying too.
- Fix: declare the set through the metadata door (`PUT /api/v1/meta/permission/NAME`) or in a package.
- A permission set that resolves only because a POSITION of the same name was folded into the request is dropped when the activation ledger (`sys_metadata_activation`, type `permission`) switched it off. The row's `active` column is not read.

**Delegated administration (ADR-0090 D12).**

- FROM: the sets a position distributes were its `sys_position_permission_set` rows in the caller's organization; `delegatable` was the organization's `sys_position` row's; the assignable-positions listing (`describeDelegableScope`) listed `sys_position` rows; a direct grant's set (and its `adminScope`) was its `sys_permission_set` row.
- TO: all four read the security catalog by name. A position distributes the sets its definition's `permissionSets` names, so the containment check and the listing see a binding declared only on the definition. `delegatable` is the definition's. The listing offers every position the catalog holds. A direct grant's set is the catalog's definition of the name the grant carries; a grant naming a set the catalog does not hold is refused for a delegate (a tenant administrator is not judged).
- A name a position's `permissionSets` carries that the catalog does not hold must be on the delegate's allowlist too. It grants nothing today, but it starts granting as soon as a set of that name is authored.
- A catalog read that fails refuses the delegate's write. Before, it approved it as "distributes nothing".

**The permission explainer.** "deactivated" is read from the activation ledger through the resolver's own read, so explain and enforce agree. A direct grant whose set the catalog does not hold is reported neither as expired nor as deactivated: there is no set to lose.

**Position assignments (`sys_user_position.position`).**

- FROM: refused `400 VALIDATION_FAILED` unless a `sys_position` row (the writer's organization's, or an organization-less one) carried the name. A position declared only in a package or saved only through the metadata door was refused.
- TO: refused unless the security catalog holds a position of that name. A registry-declared position is accepted. A name only a `sys_position` row carries (with no definition) is refused, because it grants nothing. A deactivated position is still accepted.

**One position name per deployment under `single`.**

- FROM: a Setup create of a position, or a rename into a name, that an environment definition already held overwrote that definition (another organization's label and description, an empty `permissionSets`).
- TO: refused `409 UNIQUE_VIOLATION`, the answer a second row of the name in one organization already gets, and the row write is undone. This covers a definition another organization's row wrote, one saved through the metadata door, and one an application stack declares. A name a package or a built-in holds keeps its `403 NOT_OVERRIDABLE`.

**`@objectstack/core`.** `readDisabledCatalogNames(ql, positions, sets)` is exported: the resolver's one read of the activation ledger. It returns the names switched off for this deployment and is now shared by the explainer and the security plugin.
