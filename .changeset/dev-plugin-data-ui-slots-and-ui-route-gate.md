---
'@objectstack/plugin-dev': minor
'@objectstack/runtime': patch
---

Retire the `data` and `ui` dev stubs; discovery gates `/ui` on the `protocol` service that actually serves it (#4093).

**`data`**: with the `objectql` toggle on (the default), ObjectQLPlugin registers the real engine and the stub never fired anyway. In an engine-less boot it was strictly harmful: both consumers of the slot carry a deliberate empty-slot degradation the stub silently replaced with fabrication — service-automation's CRUD nodes document "no data engine → no-op success", but the stub's `insert()` minted a fake record id that downstream flow nodes then referenced as if stored; runtime's default-datasource plugin treats an absent engine as "nothing to wire". The `/data` HTTP domain never reads this slot, and discovery has read the occupant's self-description since #4130 — an empty slot is handled honestly everywhere.

**`ui`**: the slot was pure fiction — nothing in the platform registers or consumes a `ui` service; plugin-dev's shapeless placeholder was its only occupant ever. `/ui` is served by the `protocol` service (`domains/ui.ts` 503s without it), so the placeholder's only observable effect was advertising `/ui` in boots where the route could only 503.

**Runtime discovery now reads what `/ui` reads**: `routes.ui` and `services.ui` gate on `typeof protocol?.getUiView === 'function'` — the domain's own guard, byte for byte (the same rule `mcp` follows) — instead of the vestigial `ui` slot. This fixes both directions: a boot with a placeholder but no protocol no longer advertises a route that can only 503, and a production boot with a working protocol no longer hides a route that serves. The unavailable message names the actual remedy (register MetadataPlugin) instead of "install a ui plugin", which doesn't exist.

FROM → TO: dev boots no longer register `data`/`ui` stubs — the slots stay empty, exactly as production has them. Anything that resolved those slots optionally keeps its documented empty-slot path; nothing in either repo consumed the stubs' fabricated answers. Discovery's `routes.ui` may newly appear in production deployments (the route always served there) and newly disappear in protocol-less dev boots (it never worked there).
