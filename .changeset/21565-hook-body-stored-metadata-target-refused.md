---
'@objectstack/spec': minor
---

A hook whose `body` targets a table of stored metadata, `sys_metadata` or `sys_metadata_history`, is refused at parse, with the runtime's prescription: change metadata through the metadata API.

Clause-②: yes (narrowing)

<!-- adr-0087: registered hook-body-stored-metadata-target-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** An app-authored body may not touch the two stored-metadata tables: for a body, the metadata protocol is their only writer, where a change is validated and its provenance is recorded. The runtime already enforces that where a body hook becomes a handler: such a hook is refused at registration and never runs. But `HookSchema` still accepted it, so the metadata save door answered 200 for a hook that would never fire, and the author learned otherwise only from a server log.

**What is refused.** A hook carrying a `body`, in any form, whose `object` names `sys_metadata` or `sys_metadata_history`, as the string or as any member of the list. One such member refuses the whole hook, as the runtime does. The issue's `code` is `custom`, at `object` (or `object.N` for a list member), and its message names the table and ends with the runtime's prescription. The membership test is the kernel's own `isStoredMetadataBodyObject`, the predicate the runtime judges by. That covers `HookSchema`, `defineHook()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `hooks.N.object`), `os validate`, which runs the same stack parse, an artifact's parse, and the metadata save door (`422 INVALID_METADATA`).

**What stays accepted, byte for byte.** A hook with no `body` on those tables (a code `handler`, which is how the platform writes its own hooks), a wildcard (`object: '*'`) hook with a `body` (it names neither table: the runtime binds it and never runs its body for those tables' events), and every hook on any other object.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a hook with a `body` and `object: 'sys_metadata'` or `object: 'sys_metadata_history'` | change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`) instead, and delete the hook |
| a hook with a `body` whose `object` list includes either table | drop those tables from the list; change metadata through the metadata API instead |
| a hook with a `body` on `'*'` or on any other object | unchanged |

**The one-line fix: delete the hook, or remove `sys_metadata` and `sys_metadata_history` from its `object`, and make the change through the metadata API.** The runtime never ran such a hook, so removing it changes nothing an app does.

**Who is affected, measured.** No authored hook targets either table in this repository's `packages/**` and `examples/**` at `44072fc2b9` (317 hook-shaped declarations, 24 of them outside tests; the only hits are the runtime's own tests of its registration refusal) or in hotcrm at `94668373f2` (44 declarations, 40 outside tests, no hit). Deployed metadata was not measured. A stored hook row of this shape still loads, now with a `[metadata_spec_invalid]` warning and a `_diagnostics` badge, and is still never bound.

### The kit

- **The refusal.** An object-level check attached to `HookSchema` with `.superRefine(...)`. A schema derived from `HookSchema` by overriding a key must use `.safeExtend()`, which keeps the check; zod refuses `.extend()` over a refined object. The artifact-stage hook in `@objectstack/spec` now derives that way.
- **The ledger.** The D3 semantic entry `hook-body-stored-metadata-target-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: a refused hook carries no intent a rewrite could keep.
