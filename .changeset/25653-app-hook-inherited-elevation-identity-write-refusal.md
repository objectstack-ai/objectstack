---
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
---

fix(security): an app-authored hook that inherits a system context, its `ctx.api.sudo()`, and an action it reaches through `execute()` are refused writes to position holdings, permission-set grants, invitations and memberships

Clause-②: no (narrowing: an app-authored hook's inherited or sudo() elevation, and an action reached through ObjectRepository.execute(), are refused the four identity objects at run time, as a runAs: 'system' hook already is)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the run-time answer to an app-authored hook's elevated write to four platform objects. -->

**BREAKING** (a served-set narrowing) for an app-authored hook that writes `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` while elevated. A census of the hooks in this repository and in HotCRM found none that does.

Since the previous release, a hook that declares `runAs: 'system'` and an action body are refused these writes. Three other ways app-authored code ran elevated were not:

- a hook that declares no `runAs` and fires on a write made under a system context, which it inherits;
- a hook's in-process `ctx.api.sudo()`;
- an action reached through `ctx.api.object(name).execute(action)`.

Each is now refused the same way: `403 PERMISSION_DENIED`, nothing written, and under the default `onError: 'abort'` the triggering write aborts. The message names the hook and the fix: set its `runAs` to `'user'` and leave `ctx.api.sudo()` out, or use the organization endpoints for invitations and memberships.

A hook is app-authored when it is bound from metadata through the hook binder (the same hooks the `skipAutomations` opt-out skips). A hook a plugin registers in code with `engine.registerHook`, and platform code's own `sudo()`, keep writing these objects. Reads of the four objects, and writes to every other object, are unchanged.
