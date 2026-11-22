---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
'@objectstack/service-automation': patch
'@objectstack/spec': patch
---

fix(plugin-security)!: an app-authored elevation sees through the organization wall what its caller's plain door sees

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer a data operation gets when it runs under an action body's, a system hook's or a system flow's elevation, and three schema descriptions that state it: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: elevation lifts a caller's business rules, never the organization wall. An action body, a hook that runs as system (`runAs: 'system'`, a system context it inherits, its `ctx.api.sudo()`) and a flow that runs as system read and write through the organization wall exactly what the caller they run for reads and writes through it at the plain data door (ADR-0095 D1, ADR-0123 D1/D2), under every tenancy posture and on every object, a federated one included.

**BREAKING** for an action body, a system hook or a system flow run for a signed-in caller.

- FROM: the elevation, not the caller's organization wall, decided what such a context reached of a tenant-scoped object.
- TO: the caller's own organization wall decides it, applied as the plain door applies it:
  - with no active organization under `isolated`, an empty membership set under `group`, or no membership at all under `single`: its reads of a tenant-scoped object resolve to nothing (zero rows, no error), and its writes (insert, update, transfer, delete, and the recycle bin's purge and restore) are refused with `403 PERMISSION_DENIED`, naming the missing active organization or membership;
  - under `group`, a member reads and writes the union of the organizations they hold a membership in, with or without an active organization, as their own requests do;
  - on a federated object it reads only rows of the caller's organization scope, and a by-id write of a row outside it answers `404 RECORD_NOT_FOUND`, as a row that is not there;
  - an insert with no active organization on a walled tenant object, and a write naming an organization outside the caller's scope, are refused with `403 PERMISSION_DENIED`.

**Not moved.** A caller with an active organization keeps exactly that organization's reach. Objects outside tenancy, objects with no organization column, and a platform operator crossing the wall on an object whose posture permits it are answered as the caller's plain door answers them. System work that runs for no caller (a scheduled run, a platform plugin's own system context, the seeders) is unchanged, and so is a system flow that began for no caller after an approval decision: the decider is its attribution user, not its caller.

The fix for a caller: select an active organization before running the action, or start the run from a session that has one. The `runAs` descriptions of flows and hooks and the `body` description of actions now state this limit beside the other two.
