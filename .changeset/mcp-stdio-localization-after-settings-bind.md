---
'@objectstack/mcp': patch
---

MCP stdio transport now serves the workspace's CONFIGURED timezone/locale
instead of the manifest defaults

The stdio transport resolved its localization inside `MCPServerPlugin.start()`.
`SettingsServicePlugin` registers its service in `init()` but binds its data
engine from a `kernel:ready` hook registered in its own `start()`, and every
plugin's `start()` body runs strictly before the first `kernel:ready` handler —
so that read was inside the settings bind window under **every** composition
order. Being ordered after the settings plugin did not help, and the
`optionalDependencies` edge that repairs the neighbouring ordering defects would
not have moved it either.

In that window the read does not fail: the empty in-memory fallback plus the
manifest defaults answer with `source: 'default'`, so `resolveLocalizationContext`
returned `UTC` / `en-US` and reported success, never reaching its direct
`sys_setting` fallback. The value is then held for the life of the transport by
design, so a long-lived stdio MCP server served every call with `UTC` / `en-US`
on a workspace whose persisted `localization` settings said otherwise, and never
self-corrected.

The resolution now happens from a `kernel:bootstrapped` hook — the earliest phase
strictly after the bind, and the one `SettingsService.reportPreBindRead` names as
the remedy — memoized so it stays one resolution for the life of the transport
rather than a per-call settings read. A host that never fires the boot hooks
resolves it lazily at first use instead, so nothing can deadlock on a hook that
never arrives.

**Behaviour change on a declared setting**: a deployment that has configured
`localization.timezone` / `localization.locale` / `localization.currency` will
see those values take effect on the stdio MCP surface, where it previously
always received the platform defaults. Formula evaluation (`ctx.timezone`) and
message localization on that surface change accordingly.
