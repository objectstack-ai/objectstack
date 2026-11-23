---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
'@objectstack/service-automation': patch
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/trigger-record-change': patch
---

fix(plugin-security)!: an app-authored elevation's reads and writes are judged by its caller's organization wall

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer a data operation gets when it runs under an action body's, a system hook's or a system flow's elevation, and three schema descriptions that state it: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: elevation lifts a caller's business rules, never the organization wall. An action body, a hook that runs as system (`runAs: 'system'`, a system context it inherits, its `ctx.api.sudo()`) and a flow that runs as system have their reads and writes judged by the organization wall of the caller they run for (ADR-0095 D1, ADR-0123 D1/D2), under every tenancy posture and on every object, a federated one included.

**BREAKING** for an action body, a system hook or a system flow run for a signed-in caller.

- FROM: the elevation, not the caller's organization wall, decided what such a context reached of a tenant-scoped object.
- TO: the caller's own organization wall decides it:
  - with no active organization under `isolated`, an empty membership set under `group`, or no membership at all under `single`: its reads of a tenant-scoped object resolve to nothing (zero rows, no error); its delete and purge are answered by that read rule (a predicate delete matches nothing, a by-id delete answers `404 RECORD_NOT_FOUND`); and its other writes (insert, update, transfer, and the recycle bin's restore) are refused with `403 PERMISSION_DENIED`, naming the missing active organization or membership;
  - under `group`, a member reads and writes the union of the organizations they hold a membership in, with or without an active organization;
  - its reads and predicate writes take the caller's wall on their predicate, and a by-id write of a row outside it answers `404 RECORD_NOT_FOUND`, as a row that is not there; a federated object included;
  - an insert with no active organization on a walled tenant object is refused with `403 PERMISSION_DENIED`;
  - for every caller, an active organization included: a write whose own data names an organization outside the caller's wall, and an update whose own data empties a row's organization, are refused with `403 PERMISSION_DENIED`;
  - the check of the row a by-id write names is read inside the transaction the write carries, so a row the body's own transaction wrote is the caller's to write again in it;
  - a system flow started by a record change, and every system run whose own user is its caller, carries that user's membership set and posture rung from run setup: under `group` it reads the union of the user's memberships, with or without an active organization. The set and rung are those of run setup: a membership the user gains or loses while the run waits is read by the next run. A decided segment, a run that began for no caller and a child run of either carry neither: a decided segment's caller's facts are resolved for it again.

**Not moved.** A caller with an active organization keeps exactly that organization's reach. Objects outside tenancy, objects with no organization column, and a platform operator crossing the wall on an object whose posture permits it are answered as the caller's own requests answer them. System work that runs for no caller (a scheduled run, a platform plugin's own system context, the seeders) is unchanged, and so is a system flow that began for no caller after an approval decision: the decider is its attribution user, not its caller. A run that a write of such a segment starts begins for no caller too, and carries neither the writer's membership set nor its posture rung; its trigger user stays the writer, so an approval's submitter exclusion, who may read the run's state, and the run's history answer as before. A run that a write of a decided segment of a run that began for a caller starts begins for the decider, as before. A system flow that began for a caller is judged by that caller after a decision, not by the decider.

The fix for a caller: select an active organization before running the action, or start the run from a session that has one. A body that must place a row in another organization does so as a member of that organization, through its own request. The `runAs` descriptions of flows and hooks and the `body` description of actions now state this limit beside the other two.

Also in this change:
- `@objectstack/core` exports `RUN_CALLER`, `markRunCaller` and `runCallerOf`: the server-constructed mark a flow run's data context carries wherever the run's own user is not its caller (a decided segment, a run recorded as begun for no caller in every segment, and a child run of either), naming the user its run began for, or that it began for none.
- `@objectstack/service-automation`: a `runAs: 'system'` run's data context carries the run user's membership set (`accessible_org_ids`) and posture rung, seeded once at run setup; it carries no grants. A run context may record `beganForNoCaller: true`. A run whose own user is not its caller is seeded with neither, and its data context carries neither.
- `@objectstack/objectql`: the hook session of a write made under that mark, for a run that began for no caller, carries it; `@objectstack/trigger-record-change` records that the run such a write fires began for no caller, and keeps the writer as its trigger user.
