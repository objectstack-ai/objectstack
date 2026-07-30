---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

Both discovery builders now compute the `metadata` service entry from the implementation that fills the slot, instead of hardcoding opposite verdicts for it (#4089).

`metadata` sat in a "kernel-provided (always available)" block above the loop that reads `__serviceInfo`, hardcoded separately in each builder — and the two disagreed about the same slot:

- `@objectstack/runtime`'s dispatcher declared it permanently `status: 'degraded'` with `message: 'In-memory registry; DB persistence pending'`, so a stack with `MetadataPlugin` and a real `sys_metadata` table was still reported as having no persistence.
- `@objectstack/metadata-protocol` declared the same slot permanently `status: 'available'`, so the kernel's in-memory fallback (`createMemoryMetadata`, auto-registered when no metadata plugin is present) read exactly like a persisted registry — the `__serviceInfo` marker #4058 gave it went unread here.

Both now read the registered service's `__serviceInfo` (via `readServiceSelfInfo`) and report what it declares:

- kernel in-memory fallback, or plugin-dev's dev registry → `status: 'degraded'` plus that implementation's own `message`, which names what is missing and what to install.
- `MetadataPlugin` (or any implementation carrying no marker) → `status: 'available'` with no message.

`handlerReady: true` is now stated unconditionally on both sides: it answers "is `/api/v1/meta` mounted?", and that route is served by the protocol whichever implementation occupies the slot — a degraded service in it does not unmount the route. Nothing about routing, gating, or dispatch changes; consumers that treat `status` as a capability claim (AI agents, the console) simply stop being told two different things by two hosts.
