---
'@objectstack/spec': minor
---

feat(spec)!: a `runAs: 'system'` hook or a `script` action whose sandboxed body writes an identity-assignment object is refused at save

App-authored automation does not use elevation to write `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member`. The data middleware already refuses that write at run time with `PERMISSION_DENIED` (403), from a system flow run, a hook that runs as system and an action body. Until now every authoring door still accepted a hook or action whose body says so in writing, and the author learned otherwise only from a failed write. The parse now refuses it too:

- `HookSchema` refuses a hook that declares `runAs: 'system'` and carries a sandboxed JS body (`language: 'js'`) whose `source` calls `insert`, `update`, `delete`, `updateMany`, `deleteMany` or `upsert` on `ctx.api.object('<object>')` for one of the four objects, on the handle or on a name the body bound it to.
- `ActionSchema` refuses a `type: 'script'` action whose sandboxed JS body does the same. An action body always runs as system.
- One `custom` issue per object, at `body.source`, naming the object and the route: `runAs: 'user'` (a hook) or a `runAs: 'user'` flow (an action) for position holdings and permission-set grants, so the ADR-0090 D12 delegated-administration gate judges the user; the organization endpoints for invitations and memberships. It surfaces at `os validate`, at `defineStack` (`422 STACK_SCHEMA_INVALID`), at an artifact's parse and at the metadata save door (`422 INVALID_METADATA`).
- `Hook.runAs` now says that elevation does not reach identity assignment, as `FlowSchema.runAs` does.

Unchanged: reads of the four objects, writes to every other object, a hook under `runAs: 'user'` or `'inherit'`, an expression (L1) body, a code `handler`, and the run-time refusal, which stays the enforcement for every elevated write.

Clause-②: no (narrowing) — `HookSchema` and `ActionSchema` refuse a body they used to accept. Nothing is widened.

Metadata-protocol: narrowed (a `runAs: 'system'` hook or a `script` action may no longer carry a sandboxed body that writes an identity-assignment object)

Ruling-ref: 6384657105 (letter A); retriage 6431012701

<!-- adr-0087: registered hook-action-body-system-identity-assignment-write-refused -->

**BREAKING** for an author whose system hook or action body writes one of the four objects. Such a write was already refused when the body ran.

- **Before.** The hook or action saved, and its write failed at run time with `PERMISSION_DENIED`.
- **Now.** The hook or action is refused at save, at `body.source`.
- **Fix.** For a position holding or permission-set grant, set the hook's `runAs` to `'user'`, or move an action's grant to a flow whose `runAs` is `'user'` (an action of `type: 'flow'` runs it as the invoking user). For an invitation or membership, call `POST /api/v1/auth/organization/invite-member`, `cancel-invitation`, `update-member-role` or `remove-member`.
