---
'@objectstack/runtime': patch
---

fix(runtime)!: the `/mcp` bridge's `list_actions`, `run_action` and `resume_run` read the actions no object embeds from the merged `action` listing, so a package's object-less action and an environment-authored one are listed and run, and a disabled package's is omitted

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object or action definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is where the HTTP MCP bridge reads the standalone `action` items from: the protocol's merged listing, the one `GET /api/v1/meta/action` already serves, instead of the metadata service's `loadMany('action')`. The functions that change (`collectActionDeclarations`, `resolveActionByName`, `invokeBusinessAction`, `resumeActionRun`) are not published by `index.ts`, and each gains only an optional trailing input. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (`list_actions`, `run_action` and `resume_run` stop serving a disabled compiled-artifact package's object-less actions), shipped as `patch`: it changes which reads the MCP bridge answers, not what a metadata author can write.

The HTTP MCP bridge (`POST /api/v1/mcp`) collected the `action` items that no object embeds, the object-less (`global`) actions among them, from the `metadata` service's `loadMany('action')`. That call reads the service's loaders alone. They hold the compiled artifact's actions, but not an action a package registers through the `manifest` service (a capability plugin during the boot, or a marketplace install) and not an environment-authored action saved through `PUT /api/v1/meta/action/NAME`. Those live in the registry and in `sys_metadata`, which `GET /api/v1/meta/action` reads, and REST's `POST /api/v1/actions/global/NAME` ran them.

- **Before.** On every kernel, such an action was missing from `list_actions`, `run_action` answered `Action 'NAME' not found` (`Action 'NAME' not found on object 'global'` when scoped), and `resume_run` refused a run of such a flow action `403`.
- **Now.** The three tools collect those items from the protocol's merged `action` listing, the one `GET /api/v1/meta/action` serves, through the same read the object listing uses. Such an action is listed, resolved and dispatched behind the same gates as before (`ai.exposed`, `requiredPermissions`, the activation switch, the declared params, `ai.requiresConfirmation`, a registered handler for a script action), and runs as REST's `/actions` door runs it.
- **Also changed.** A compiled-artifact package's object-less action stayed in the loader after the package was disabled, so it was still listed and run. It is now omitted from `list_actions`, and `run_action` answers `Action 'NAME' not found` for it, as the package's objects are omitted since #25120. When the merged `action` listing throws, the three tools fail with that error instead of reading the `metadata` service.
- **Unchanged.** The compiled artifact's actions are listed and run as before. An object-embedded declaration still wins over a standalone one with the same object and name. A host with no `protocol` service, or one without the merged listing, keeps reading `loadMany('action')`. REST's `/actions` door is untouched.
- **What to do.** Nothing. An agent that ran a disabled package's action through MCP was running an action whose package the rest of the platform no longer serves: re-enable the package to restore it.
