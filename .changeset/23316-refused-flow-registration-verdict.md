---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/service-automation': minor
---

A stored flow the automation engine refuses is no longer served as running: the flow meta read serves the engine's verdict beside the item as `registration`, an envelope sibling of `lock`, and the flow list serves it as `registrations` keyed by flow name, so a refused flow reads `{ state: 'refused', reason: { code?, message } }` beside its stored `status`, which stays as authored.

Clause-②: yes (widening)

- **The shape** (`@objectstack/spec`). `FlowRegistrationSchema` is a closed set: `registered` (the engine holds the flow), `refused` (it refused the stored flow and holds nothing under the name; `reason` carries the engine's own `message` and, when the thrown error set one, its `code`, verbatim), and `unregistered` (it holds nothing and refused nothing: a read during boot, between a save and the engine following it, or after a deliberate unregister). `GetMetaItemResponseSchema` gains `registration` and `GetMetaItemsResponseSchema` gains `registrations`, both optional. New exports: `FlowRegistrationSchema`, `FlowRegistrationRefusalSchema` and the types `FlowRegistration` and `FlowRegistrationRefusal`. `IAutomationService` gains the optional member `getFlowRegistration(name)`.
- **Where the verdict comes from** (`@objectstack/service-automation`). The `kernel:ready` cold-boot bind records each flow it refuses, with what the engine threw, after it withdraws the flow; the `metadata:reloaded` re-sync and the metadata-change sync record a refusal that leaves the name unregistered. A later successful registration of the name, or its withdrawal, ends the record. `AutomationEngine` answers `getFlowRegistration(name)` and takes `recordFlowRefusal(name, error)`. The refusal's warn line, its level and the withdrawal are unchanged.
- **Where it is served** (`@objectstack/metadata-protocol`). The protocol reads the engine through the kernel's service table by name, as it already reads the engine's stored-flow canonicalizer; it does not import the automation service. The field is absent where no automation service declares the member, on every type other than `flow`, on a draft read, on the execution face the engine binds from, and, like `lock`, on the cached item read: absence means no engine judged the flow, never `registered`. The verdict is the engine of the process that answered the read.
