---
'@objectstack/spec': minor
---

spec(ui): `requiredPermissions` on a `type: 'api'` action — a same-origin api action is gated at the platform action door (ADR-0066 D4 amended 2026-10-29)

Clause-②: no
Metadata-protocol: semantic

The documented meaning of `requiredPermissions` on a `type: 'api'` action changes; no key, accepted value or default moves, and the schema shape is unchanged.

- **Before.** The `requiredPermissions` docblock and `.describe()` (and the generated references under `content/docs/references/`) said a `type: 'api'` action pointed at a custom endpoint is called by the browser directly, never passes through the platform action route, and that the endpoint must re-check the capability itself — the 2026-07 scope note of ADR-0066 D4.
- **Now.** Per ADR-0066 D4 as amended on 2026-10-29, a `type: 'api'` action whose `target` is a same-origin platform path is dispatched by the platform action door — `POST /actions/:object/:action` and the MCP `run_action` bridge — which runs the D4 capability gate, the anonymous baseline and the ADR-0126 activation consult before forwarding the call in-process to the declared `target` as the caller. The target endpoint keeps re-checking its own authorization (defence in depth, not a replacement). An api action whose `target` is not a same-origin platform path stays browser-only and ungoverned: the door does not dispatch it, MCP does not list it, and the activation switch refuses to flip it. The description also drops `modal` from the list of server-dispatched types: the door dispatches `script`, `flow` and the declarative `operation: 'update'` write, and answers a `modal` action 400 as a client-side type.
- **Landing.** ADR-0066 records the decision; the runtime that implements the door's api forwarding ships separately (ADR-0066 D4's amendment note names the server card). Until it lands the door still refuses `type: 'api'` and the console fetches `target` directly. Nothing an author writes today is refused or re-read differently by this release.
