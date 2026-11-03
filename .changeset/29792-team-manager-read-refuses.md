---
'@objectstack/plugin-sharing': patch
'@objectstack/spec': patch
---

fix(plugin-sharing)!: a failed team-graph manager read refuses instead of answering no manager

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata changes: the lookup reads the row it already read, and refuses a read that already failed. The spec change is interface documentation only. No author has anything to rewrite. -->

**BREAKING** only where the read fails: `TeamGraphService.managerOf` used to answer `null` then, and now refuses.

The holder reads of `TeamGraphService`, and the head and standalone manager lookups of `BusinessUnitGraphService`, already refuse on a failed read. This was the last lookup of that family that did not.

- **`TeamGraphService.managerOf(userId, organizationId)`.** A failed `sys_user` read now throws. Before, it answered `null` (no manager) and kept that answer for the rest of the pass, so the manager stayed missing after the read recovered. Nothing is cached after a failed read now: the next call reads again.
- **Who sees it.** The `manager` arm of the exported `expandPrincipal`, and `BusinessUnitGraphService.managerOf` when it is built with a `teamGraph`, pass the refusal through instead of answering no manager.
- **A missing object is still nobody.** A stack that never registers, or never creates, `sys_user` keeps answering `null`. That is judged by `isObjectAbsentError`; any other error stays loud.
- **The organization screen is unchanged.** When `sys_member` cannot be read, the manager is still kept, as before.
- **The refusal names a lookup.** A failed head or manager lookup now says it is a lookup of one person, not a holder set or an expansion.
- **The contract says so.** The documentation of `ITeamGraphService.managerOf` and `IBusinessUnitGraphService.headOf` in `@objectstack/spec` now reads "refuses (throws) on a failed read; `null` when none" instead of "best-effort". No key or type changes.
- **No caller on this release changes behaviour.** No sharing rule, approval or ownership queue on this release calls `managerOf` or `expandPrincipal`. A caller of the exported class or function sees the refusal instead of `null`.

**The remedy.** None is needed. A refusal means the user table could not be read: fix that read, and the next lookup succeeds.
