---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
'@objectstack/service-automation': patch
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/trigger-record-change': patch
---

fix(plugin-security)!: an app-authored elevation sees through the organization wall what its caller's plain door sees

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer a data operation gets when it runs under an action body's, a system hook's or a system flow's elevation, and three schema descriptions that state it: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: elevation lifts a caller's business rules, never the organization wall. An action body, a hook that runs as system (`runAs: 'system'`, a system context it inherits, its `ctx.api.sudo()`) and a flow that runs as system read and write through the organization wall exactly what the caller they run for reads and writes through it at the plain data door (ADR-0095 D1, ADR-0123 D1/D2), under every tenancy posture and on every object, a federated one included.

**BREAKING** for an action body, a system hook or a system flow run for a signed-in caller.

- FROM: the elevation, not the caller's organization wall, decided what such a context reached of a tenant-scoped object.
- TO: the caller's own organization wall decides it, applied as the plain door applies it:
  - with no active organization under `isolated`, an empty membership set under `group`, or no membership at all under `single`: its reads of a tenant-scoped object resolve to nothing (zero rows, no error); its delete and purge are answered by that read rule, as its plain door answers them (a predicate delete matches nothing, a by-id delete answers `404 RECORD_NOT_FOUND`); and its other writes (insert, update, transfer, and the recycle bin's restore) are refused with `403 PERMISSION_DENIED`, naming the missing active organization or membership;
  - under `group`, a member reads and writes the union of the organizations they hold a membership in, with or without an active organization, as their own requests do;
  - on a federated object it reads only rows of the caller's organization scope, and a by-id write of a row outside it answers `404 RECORD_NOT_FOUND`, as a row that is not there;
  - an insert with no active organization on a walled tenant object is refused with `403 PERMISSION_DENIED`;
  - for every caller, an active organization included: a write that names an organization outside the caller's scope, and an update that empties a row's organization, are refused with `403 PERMISSION_DENIED`, as at the plain door. Such an elevation could land a new row in, or move a row into, an organization its caller cannot write in; it no longer can;
  - the check of the row a by-id write names is read inside the transaction the write carries, so a row the body's own transaction wrote is the caller's to write again in it;
  - a system flow started by a record change, and every system run for a user, carries that user's membership set and posture rung from run setup: under `group` it reads the union of the user's memberships, as the user's own request does, with or without an active organization.

**Not moved.** A caller with an active organization keeps exactly that organization's reach. Objects outside tenancy, objects with no organization column, and a platform operator crossing the wall on an object whose posture permits it are answered as the caller's plain door answers them. System work that runs for no caller (a scheduled run, a platform plugin's own system context, the seeders) is unchanged, and so is a system flow that began for no caller after an approval decision: the decider is its attribution user, not its caller. A run that a write of such a segment starts begins for no caller too (it records no trigger user; the writer stays its attribution user). A system flow that began for a caller is judged by that caller after a decision, not by the decider.

The fix for a caller: select an active organization before running the action, or start the run from a session that has one. A body that must place a row in another organization does so as a member of that organization, through its own request. The `runAs` descriptions of flows and hooks and the `body` description of actions now state this limit beside the other two.

Also in this change:
- `@objectstack/core` exports `RUN_CALLER`, `markRunCaller` and `runCallerOf`: the server-constructed mark a decided flow segment's data context carries, naming the user its run began for, or that it began for none.
- `@objectstack/service-automation`: a `runAs: 'system'` run's data context carries the run user's membership set (`accessible_org_ids`) and posture rung, seeded once at run setup; it carries no grants.
- `@objectstack/objectql`: the hook session of a write made by a decided segment of a run that began for no caller carries that mark; `@objectstack/trigger-record-change` starts the run such a write fires with no trigger user.
