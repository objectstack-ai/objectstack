---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the `position_name_fold_grant` warning says the same-name grant is removed in the next major version, and what holders lose then

Clause-②: no (a runtime warning's wording plus one added field in its log payload; no accept set, served shape, resolution result or error code moves)

- **What it was.** A position resolves the permission set that has its own name even when the position's definition does not list that set in `permissionSets`. `plugin-security` has warned about this since 17.3 (`position_name_fold_grant`), once per position. The warning said the grant was "in force and ungoverned" and asked for `permissionSets: ['P']` or a rename. It did not say that this name-based grant is being retired, or what happens to holders when it is.
- **What changed.** The warning now says three things. The set is in force for holders of position `P` only because the two share a name. This name-based grant is deprecated and is removed in the next major version: from then on, holders of `P` do not receive set `P` unless `P`'s definition names it. To keep the grant, declare `permissionSets: ['P']` on position `P`; if the shared name is a coincidence, rename one of the two. The structured payload adds `removedIn: 'next_major'`. `event`, `position` and `permissionSet` are unchanged.
- **Why only a warning in 18.x.** No ADR-0087 conversion can carry this retirement: the platform cannot write `permissionSets` into a sealed managed position definition (ADR-0131 D6). So 18.x ships the warning, and the removal of the name-based grant waits for 19.0.
- **Unchanged.** Every resolution result. A holder of `P` still receives set `P` in 18.x. The warning still fires under the same conditions, including for a position bound to a different set that also shares its name with one. It stays silent for a declared pair, a baseline set and a position whose name matches no set, and it still fires once per position name until the next restart.
- **What to do.** For each position named in a `position_name_fold_grant` warning, add the same-named set to that position's `permissionSets` before upgrading to the next major version. Setup's Permission Sets field and the set's Assigned Users panel then show the binding as well.
