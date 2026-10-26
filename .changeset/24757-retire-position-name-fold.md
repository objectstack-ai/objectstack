---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
---

fix(plugin-security)!: a permission set that shares a held position's name is no longer granted; declare it in the position's `permissionSets` (#24757)

Clause-②: yes (narrowing: a holder of position `P` is no longer granted the permission set named `P` unless `P`'s definition names it in `permissionSets`; widened: `@objectstack/core`'s `UserAuthzGrants` and `ResolvedAuthzContext` gain the additive field `directPermissions`)
Metadata-protocol: none
Ruling-ref: #13419 ruling B (`5472608110`); 「甲」 as amended (`6303865025`); order and unlock on #24757 (`6290781571`, `6392096931`); #25799 seat ruling A (claims `6414302166`, `6414315157`)

ADR-0131 D3/D4: a position grants only the permission sets its definition's `permissionSets` names — the binding is written, not inferred. The security plugin's set resolution still requested every held position's NAME as a permission-set name too (the position-name fold), so a set that happened to share a position's name was granted to its holders without anyone writing the binding. #13419 ruling B retires that channel; HotCRM declared its bindings first (objectstack-ai/hotcrm#2200, released in hotcrm `v6.0.0`).

What changes:

- `resolvePermissionSetsForContext` requests only the context's `permissions` and the baseline. A held position's name reaches no set. `dropDeactivatedFoldedSets`, the second activation read that only the fold needed, is gone.
- The `position_name_fold_grant` warning keeps its event name and fields and now says the opposite: the same-named set is **not** granted, and how to grant it (`permissionSets: ['P']`) or to rename one of the two. Its payload carries `granted: false`. It is still logged once per position name per process.
- `describePositionGrants` lists only the sets a position's definition names, so it no longer serves `via: 'name'`. The `'name'` member of `PositionGrantVia` (`@objectstack/spec`) and its UI badge are retired separately in #26022; until then the value is published but never served.
- The delegated-administration gate judges an assignment of position `P` on the sets `P`'s definition names only. A set that only shares `P`'s name is no longer walked for the allowlist, the containment check or the organization boundary, because no assignment grants it.
- `explainAccess` attributes a set to `position:P` when `P`'s definition names it, and says `direct grant` otherwise. When the position definitions cannot be read it says so, rather than guessing either. A set held both through the user's own grant row and through a held position's definition reads `direct grant + position:P`, so revoking the position is not mistaken for removing the access (#25799).
- `@objectstack/core`: `UserAuthzGrants` and `ResolvedAuthzContext` gain `directPermissions: string[]`, the names conferred by the user's own `sys_user_permission_set` rows that apply in the active organization (a set a position definition also names included, a set only a definition names excluded). It is additive and grants nothing; the explainer reads it. Code that builds either object by hand must now set it (`directPermissions: []` when there are no grant rows).
- The lint gate `check-position-name-fold-loaders` and the census script `measure-position-name-fold-census` are deleted. They guarded the fold's only route, which no longer exists.

**BREAKING** for an environment that relied on a shared name to grant a set.

- **Before.** A user holding position `sales_manager` was granted the permission set `sales_manager` whether or not the position's definition named it.
- **Now.** That user is granted only the sets the `sales_manager` definition lists in `permissionSets`. The first resolution that would have folded the set logs `position_name_fold_grant` with `granted: false`, naming the position and the fix.
- **Fix.** Name the set in the position: `permissionSets: ['sales_manager']`. If the shared name is a coincidence, nothing needs to change.
- **Cloud ordering.** An environment running HotCRM must be on the HotCRM release that declares its bindings (`v6.0.0` or later) before it takes this release.

<!-- adr-0087: not-required (no-migration-prescription) a run-time narrowing in the security plugin's permission-set resolution: a held position's name is no longer requested as a permission-set name. No authorable key, spelling or stored shape moves, the position and permission-set schemas parse exactly as before, and no stored row is read, rewritten or converted. The repair is the author's choice between naming the set in the position's `permissionSets` and leaving it ungranted, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); nothing exported from `@objectstack/spec` moves in this change; and the one type change, the additive `directPermissions` on `@objectstack/core`'s resolver output, is a per-request value no stored artifact or authored metadata carries, so no conversion has a source to rewrite. -->
