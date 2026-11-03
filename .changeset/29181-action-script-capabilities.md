---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): the action editor grants a sandboxed-JS script body its capabilities

Clause-②: no
Metadata-protocol: none

A script action authored in Studio with a sandboxed-JS (L2) body that reads or writes data was refused on every click (`INSUFFICIENT_PRIVILEGES`, "capability 'api.write' not granted"), because the action editor drew no control for `body.capabilities` and only raw metadata could grant it. The editor now shows a Capabilities grant list under the body for a `Sandboxed JS (L2)` body: one checkbox per `HookBodyCapability` token, read from the spec enum, each naming the `ctx` call it unlocks.

- It is the Hook editor's control, now shared by both editors, because a hook body and an action body are the same spec union. The Hook editor's behaviour is unchanged.
- An expression (L1) body shows no grant list, and switching a body to expression still drops the grant with the other L2-only keys, so the save parses.
- An action with no `capabilities` loads and saves unchanged: no key is written until a grant is ticked. Unticking the last grant writes `[]`, the spec default, as the Hook editor does.
- New Studio catalogue row `engine.inspector.action.capabilitiesHint` (en, zh), which says a call that is not granted is refused when the action runs.
