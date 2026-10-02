---
'@objectstack/runtime': minor
'@objectstack/cloud-connection': patch
---

An app installed with `os package install <artifact>` now runs its `type: 'script'` action bodies and its body hooks, and MCP `list_actions` lists a script action only when `run_action` can run it (#21321).

Clause-②: yes (widening)

- **`@objectstack/runtime`.** New export `bindAppArtifactHandlers(ql, bundle, { appId, logger, source? })`. It binds every action `body` of an artifact through `ql.registerAction`, and every hook `body` and bundle function through `ql.bindHooks`, all under the owner `app:<appId>`. `appArtifactHandlerOwner(appId)` returns that owner key. Each call first removes the action handlers and hooks the same owner bound before. A reinstall therefore leaves one handler per action, and an action or hook that the new version dropped stops running. `AppPlugin.start` now binds through this function, with the same log lines and the same results for a boot artifact.
- **`@objectstack/runtime`, MCP `list_actions`.** A `script` action is listed only when the engine has a handler registered for it. The check reads `listRegisteredActions()` and uses the same object and key order as `run_action`. Before, a declared `target` or `body` was enough to be listed, so `list_actions` could list an action that `run_action` refused with "No handler registered". An engine without `listRegisteredActions` gets no script actions listed. Declarative update actions and `flow` actions are listed as before.
- **`@objectstack/cloud-connection`.** The install-local plugin calls `bindAppArtifactHandlers` on `POST /api/v1/marketplace/install-local` and when it rehydrates its ledger at `kernel:ready`. Before, an installed package's script actions answered REST `404 RESOURCE_NOT_FOUND` and MCP "No handler registered", before and after a restart, and its body hooks never ran. The same artifact booted with `os start --artifact` was not affected.
