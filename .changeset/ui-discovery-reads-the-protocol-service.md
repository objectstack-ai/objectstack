---
'@objectstack/runtime': patch
---

Discovery's `/ui` advertisement reads what `/ui` reads: the `protocol` service, not the vestigial `ui` slot (#4093).

`domains/ui.ts` serves `GET /ui/view/:object` off the `protocol` service and 503s without it; the `ui` core-service slot never enters that decision, and nothing in the platform registers a `ui` service — plugin-dev's shapeless placeholder was its only occupant ever, and ADR-0115 retired it. Gating `routes.ui` on slot presence was therefore wrong in both directions: a dev boot with the placeholder but no protocol advertised a route that could only 503, and every boot without a placeholder — production always, and all dev boots post-ADR-0115 — hid a route that serves fine.

`routes.ui` and `services.ui` now gate on `typeof protocol?.getUiView === 'function'` — the domain handler's own guard, byte for byte, the same rule the `mcp` advertisement follows. `services.ui` reports the serving implementation (provider `metadata-protocol`, honoring any `__serviceInfo` it declares), and the unavailable message names the actual remedy — register MetadataPlugin (`@objectstack/metadata-protocol`) — instead of "install a ui plugin", which names a plugin that does not exist.

FROM → TO: `routes.ui` / `services.ui` may newly appear in deployments where the protocol service is registered (the route always served there; discovery just never said so) and newly disappear in protocol-less boots (it never worked there). No handler behavior changes.
