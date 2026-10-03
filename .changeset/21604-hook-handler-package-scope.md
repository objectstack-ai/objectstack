---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

fix(objectql,spec)!: a hook's `handler` name resolves inside the hook's own package only (#21604)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, spelling, export of a published release or stored shape moves: `HookSchema`'s shape is unchanged (only `HookSchema.handler`'s doc changes), so `objectstack migrate meta` has nothing to rewrite. What changes is which function a string `handler` may bind to at registration. Census of compositions relying on cross-package resolution by name, at the claim: zero in objectstack `examples/**` (15fe567c9c, whose only string `handler` is a job's), hotcrm (f24c196588) and objectos (7612ffebd1); this repository commits no `--artifact` runtime module; cloud is NOT MEASURED (unreachable from the claim's session). The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers a binding rule (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: a hook whose `handler` is a function NAME (the deprecated form, `handler: 'my_fn'`, with no `body`) now binds only to a function its own package holds. It used to fall back to the engine-wide function registry, which is keyed by bare name, so the hook could bind to a function another package registered under the same name and run that package's code on its own events.

- **Accepted before:** a string `handler` resolved against the functions handed to the hook's bind, then against every function any package had registered on the engine. A name found nowhere was skipped with a `warn`.
- **Accepted now:** a string `handler` resolves against the functions handed to the hook's bind (the package's `functions`, which an `--artifact` runtime module supplies), then against the functions the same package (`packageId`) registered on the engine. Nothing else.
- **Refused now, at registration:** a name the hook's own package does not hold, whether another package registered it or nobody did. The hook is not bound. The refusal carries `INVALID_REFERENCE` with status `400` (ADR-0112), names the hook, the function and the package, and is recorded on the bind result (`BindHooksResult.errors[]` gains `code` and `status`) and logged at `error`. Under `strict` (`OBJECTQL_STRICT_HOOKS=1`) it is thrown.
- **The doors:** a hook authored at runtime through the metadata API (`PUT /api/v1/meta/hook/:name`) ships with no code package and holds no functions, so a `handler`-only hook authored there is refused when the door binds it; the save itself still answers as before. In a composition of several apps, one app's hook can no longer bind to another app's function. A bind that names no owning package (direct `bindHooksToEngine` use without `packageId`) resolves only the functions handed to it.
- **Unchanged:** a hook with a `body` binds as before. An app's hook naming its own `defineStack({ functions })` entry, or a function its own `--artifact` runtime module exports, binds as before. The install-local door's refusal of a hook with no `body` is unchanged.

What to do with a refused hook: give it a `body` (sandboxed JS), or declare the function in the hook's own package's `functions`. To reuse another package's function, import it from the package that owns it and declare it there. This ships as `minor`, under the launch-window convention for narrowings of an accept set.
