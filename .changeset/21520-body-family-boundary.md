---
'@objectstack/runtime': minor
---

fix(runtime)!: an app-authored body may not bind a hook to, or write, the stored-metadata tables (#21520)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no metadata body, authorable key, spelling, export or stored shape moves; what changes is which tables a sandboxed hook or action body may be bound to and may write, so `objectstack migrate meta` has nothing to rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a refused binding or a refused write (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what an app-authored body may do with the two stored-metadata tables, `sys_metadata` and `sys_metadata_history`. For an app-authored body, the metadata protocol is now their only writer: a change to metadata goes through the metadata API, where it is validated and its provenance is recorded.

- **Binding.** A hook with a sandboxed `body` whose `object` names either table, alone or in a list, is no longer bound. The refusal is made at registration, at the one point every body hook becomes a handler, so it holds on every door a hook binds by: a code bundle or boot artifact, an installed artifact, and a hook authored at runtime through the metadata door. It carries `PERMISSION_DENIED` / 403, names the metadata API, and is recorded against the hook in the bind log at `error` (thrown under strict binding). A wildcard (`'*'`) body hook still binds; its body is not run for either table's events, and the bind says so once at `info`.
- **Writing.** A sandboxed action or hook body's write of either table through `ctx.api` — every write verb, inside a transaction or not, with or without elevation — answers `PERMISSION_DENIED` / 403 before the write runs, so nothing lands and the answer does not depend on what the write names.
- **Unchanged:** a body's reads of the two tables (still served as the generic data door serves them); host code that registers its own action handlers or hooks; the platform's own hooks, which are code and still fire on the metadata door's save; and every other object.

The route: change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`) rather than from a body, and bind hooks to the objects an app owns. No shipped example binds a body hook to either table or writes one from a body. It ships as `minor` under the launch-window convention for accept-set narrowings.
