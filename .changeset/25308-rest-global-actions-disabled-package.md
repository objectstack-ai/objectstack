---
'@objectstack/runtime': patch
---

fix(runtime)!: REST's `POST /api/v1/actions/global/NAME` answers an object-less action of a disabled package the "no declaration" `404` a name nothing declares gets, before any handler runs

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object or action definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is where the `/actions` door reads a standalone action's declaration: through the protocol's by-name `action` read, which already withholds a disabled package's item, so such an action resolves to no declaration. No function is added or published; `resolveRouteActionDeclaration` keeps its signature. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the `/actions` door stops running a disabled package's object-less actions), shipped as `patch`: it changes what one door answers, not what a metadata author can write.

Disabling a package withholds its items: `GET /api/v1/meta/action/NAME` answers `404`, and the MCP `run_action` tool answers "not found". The `/actions` door refuses an action on an object of a disabled package `404 OBJECT_PACKAGE_DISABLED`, but an object-less action names no object to ask about. It resolved a standalone declaration from the engine registry or the metadata service, where a disabled package's items stay, and dispatched.

- **Before.** On every kernel shape, `POST /api/v1/actions/global/NAME` (and its empty-segment spelling `/actions//NAME`) on a disabled package's top-level action with no `objectName` ran its handler and answered `200` with its result. So did an enabled object's route that resolves the same object-less action, and the package's top-level action bound to another, enabled package's object.
- **Now.** The door reads a standalone action through the protocol's by-name `action` read (`GET /api/v1/meta/action/NAME`'s read, on its execution face), which withholds a disabled package's item. Each request above answers the "no declaration" `404`, the same status, code and message, but for the name, that a name nothing declares gets, before any gate, record load or handler. A by-name read that fails is the metadata plane failing to answer: the door's existing `503`, never a fall-back to a copy. An action on an object of a disabled package still answers `404 OBJECT_PACKAGE_DISABLED` first.
- **Also.** The activation door (`POST /api/v1/actions/_activation/OBJECT/NAME`) resolves through the same function, so a disabled package's standalone action is answered there by that door's own "no declaration" `404` too, where a flip wrote a ledger row before. Re-enable the package to switch it.
- **Unchanged.** An enabled package's object-less actions, and an environment-authored one (no owning package), run as before, through a disable of any package. Re-enabling the package restores its actions at once: nothing records the answer. A host whose protocol has no by-name read resolves from the registry and the metadata service, as before.
- **What to do.** Nothing. A caller that ran a disabled package's action through REST was running code of a package the rest of the platform no longer serves: re-enable the package to restore it.
