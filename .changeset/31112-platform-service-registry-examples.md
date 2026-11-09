---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform service-registry examples now call the service contracts they use

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/rules/service-registry.md` had two examples that typed a service by its contract and then called a method the contract refuses. Basic Usage read the `objectql` service as `IDataEngine` and called `db.object('account').find()`, which `IDataEngine` does not declare; it now calls the engine's own `db.find('account')`. Optional Services read `realtime` as `IRealtimeService` and called `publish('my-event', data)` with two arguments, where `publish` takes one `RealtimeEventPayload`; it now awaits `publish({ type, payload, timestamp })` with the payload's three required keys. The ❌/✅ pair under "No Error Handling for Optional Service" made the same two-argument `publish` call and now passes the same one-payload shape; the pair still teaches the try/catch. The API section's intro now counts the four methods its block lists. No rule's teaching changes. None of the 40 fenced TypeScript blocks in `rules/plugin-lifecycle.md`, `rules/service-registry.md` and `references/plugin-hooks.md` carries the opt-in check marker, before or after: every one needs `@objectstack/core` (the runtime `PluginContext`, `Plugin` or kernel), which `check:skill-examples` cannot resolve because it compiles against `@objectstack/spec` only.
