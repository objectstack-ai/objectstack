---
"@objectstack/plugin-hono-server": patch
---

The UI auto-discovery block in `HonoServerPlugin.start()` no longer names the retired plugin type `ui-plugin`: the `plugin.type === 'ui-plugin'` disjunct and its "Support legacy" comment are removed, and the block mounts `type: 'ui'` plugins only (#15638).

Clause-②: no

- **Why nothing a plugin declares moves.** `ui-plugin` is not a member of the closed plugin-type set (`'standard'` plus `CORE_PLUGIN_TYPES`), and `kernel.use()` already refuses it on both published kernels, before the block can see it, with `PLUGIN_CONTRACT_VIOLATION ... at 'type'`. `LiteKernel.use()` throws it as-is; `ObjectKernel.use()` throws it behind its `Failed to load plugin: NAME - ` prefix. The disjunct was reachable through neither kernel's `use()`, so the deletion changes no accept or reject verdict for any declared value, and the refusal is the generic closed-set one. There is no message specific to this spelling.
- **The one object that stops mounting.** The contract validates at `use()` and stores the plugin object by reference, so an object admitted as `ui` that then rewrites its own `type` to `ui-plugin` before `start()` used to be mounted by the removed disjunct. It no longer is.
- **Fix**: declare `type: 'ui'`, with `staticPath` and `slug` (both required for that type).
