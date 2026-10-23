---
'@objectstack/runtime': patch
---

fix(runtime)!: REST's `POST /api/v1/actions/OBJECT/NAME` refuses an action on an object whose owning package is disabled `404 OBJECT_PACKAGE_DISABLED`, the data plane's answer for that object, before any handler runs

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object or action definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is one answer of the `/actions` door: an invocation on an object whose owning package is disabled is refused with the protocol's own `404 OBJECT_PACKAGE_DISABLED`, read through the by-name object read the data verbs' exposure gate already makes. The one function added (`refuseDisabledPackageObject` in `action-execution.ts`) is not published by `index.ts`. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the `/actions` door stops running a disabled package's object actions), shipped as `patch`: it changes what one door answers, not what a metadata author can write.

Disabling a package takes its objects off every door: `/data` refuses them `404 OBJECT_PACKAGE_DISABLED`, `GET /api/v1/meta/object` omits them, and the MCP `run_action` tool answers "not found" for their actions. REST's `/actions` door did not ask. It resolved the action's declaration from the engine's schema registry, where a disabled package's objects stay registered, and dispatched.

- **Before.** On every kernel shape, `POST /api/v1/actions/OBJECT/NAME` on an object of a disabled package ran a script action's handler and answered `200` with its result; a declarative update was refused only at the record load; an action gated by `requiredPermissions` answered a caller without them `403`; and a name nothing declares answered the "no declaration" `404`.
- **Now.** Each of those is refused `404 OBJECT_PACKAGE_DISABLED`, with the error the data plane raises for the object, before any gate reads the action's declaration and before any record load or dispatch. The anonymous baseline still answers first.
- **Unchanged.** Actions on objects of an enabled package run as before, as does every gate after this one. Re-enabling the package restores the actions at once: nothing records the refusal. An object-less action (`POST /api/v1/actions/global/NAME`) names no object and is not affected. The activation door (`POST /api/v1/actions/_activation/OBJECT/NAME`) is untouched.
- **What to do.** Nothing. A caller that ran a disabled package's action through REST was running code of a package the rest of the platform no longer serves: re-enable the package to restore it.
