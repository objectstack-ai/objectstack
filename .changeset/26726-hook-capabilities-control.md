---
'@object-ui/i18n': patch
---

fix(app-shell,i18n): the Studio hook editor grants a sandboxed-JS body its capabilities

Clause-②: no
Metadata-protocol: none

A hook body that calls `ctx.api`, `ctx.log` or `ctx.crypto` needs the matching token in `body.capabilities`, or the sandbox throws when the hook runs. The Studio hook editor had no control for that list, so a hook that read data could only be fixed through the metadata API.

- **Studio (Data › Hooks, and the metadata admin's hook editor).** A sandboxed-JS body now shows a "Capabilities" checkbox per `HookBodyCapability` token (`api.read`, `api.write`, `api.transaction`, `crypto.uuid`, `log`), each with the `ctx` call it unlocks. Ticking one writes `body.capabilities`; unticking the last writes `[]`, the spec's default. An expression body shows no control, and switching a body to an expression drops its grant and its `timeoutMs` / `memoryMb` limits, since an expression body refuses those keys. A stored token the spec does not list stays on screen, flagged, until it is unticked. Nothing is inferred from the body's source.
- **`@object-ui/i18n`.** The `studio` namespace gains `engine.inspector.hook.capabilities`, `engine.inspector.hook.capabilitiesHint` and `engine.inspector.hook.capabilityUnknown` in `en` and `zh`.

No metadata key is added or changed, and the sandbox's capability check is as strict as before. What to do: nothing.
