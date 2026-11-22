---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: an app-authored elevation sees through the organization wall what its caller's plain door sees

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer a data operation gets when it runs under an action body's, a system hook's or a system flow's elevation for a caller the organization wall denies: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: elevation lifts a caller's business rules, never the organization wall. An action body, a hook that runs as system (`runAs: 'system'`, a system context it inherits, its `ctx.api.sudo()`) and a flow that runs as system read and write through the organization wall exactly what the caller they run for reads and writes through it at the plain data door (ADR-0095 D1, ADR-0123 D1/D2).

**BREAKING** for an action body, a system hook or a system flow run for a signed-in caller the organization wall denies: no active organization under `isolated`, an empty membership set under `group`, a person outside every organization under `single`.

- FROM: such an elevation's reads, updates and deletes of a tenant-scoped object were not confined to any organization.
- TO:
  - its reads of a tenant-scoped object resolve to nothing (zero rows, no error), as the caller's own reads do;
  - its writes of a tenant-scoped object (insert, update, delete, and the recycle bin's purge and restore) are refused with `403 PERMISSION_DENIED`, naming the missing active organization.

**Not moved.** A caller with an active organization keeps exactly its organization's reach. Objects outside tenancy, objects with no organization column, and a platform operator crossing the wall on an object whose posture permits it are answered as the caller's plain door answers them. System work that runs for no caller (a scheduled run, a platform plugin's own system context, the seeders) is unchanged.

The fix for a caller: select an active organization before running the action, or start the run from a session that has one.
