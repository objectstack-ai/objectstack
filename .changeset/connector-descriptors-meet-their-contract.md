---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
"@objectstack/runtime": patch
---

fix(spec,runtime,service-automation): `IAutomationService` declares the connector registry it already serves (#4127)

The fourth and last of the dispatcher call sites #4127 found calling a method its
contract never declared. The first three shipped in #4143; this one was held back
because the fix is a **type move**, not a type addition — `ConnectorDescriptor`
was declared in `@objectstack/service-automation`'s engine, which is one
*implementation* of `IAutomationService`. A contract cannot name a type that
lives inside its own implementation, so `getConnectorDescriptors` could not be
declared at all until the type had a home in the spec.

**`IAutomationService` += `getConnectorDescriptors?()`.** It is the sibling of
`getActionDescriptors`, which the contract has declared since ADR-0018: the two
fill the flow designer's `connector_action` node together — node vocabulary from
one, the connector → action → input pickers from the other. Only one of them was
written down. `GET /api/v1/automation/connectors` has served the other since
ADR-0022 by probing for the method and then re-typing its own result as `any` to
filter on `?type=`, which is a filter on a field the type system did not know
existed — one typo from silently matching nothing and answering an empty
registry, which is also what this route legitimately returns when the method is
absent, so the failure had no distinguishable symptom.

Optional for the same reason `getActionDescriptors` is: a connector registry is a
capability of the flow-engine implementation, not a property of every automation
slot. A script-runner filling the slot has no connectors to describe, and the
route answers an empty registry rather than a 404 — the `handlerReady` posture
does not apply, since the slot is serveable and only this capability is absent.

**`ConnectorDescriptor` / `ConnectorActionDescriptor` / `ConnectorOrigin` /
`ConnectorState` move to `@objectstack/spec/integration`**, beside the ADR-0097
provider contract, for the reason that file already states about itself: they are
pure types, so a connector plugin — or a designer client, or the dispatcher —
speaks about registered connectors depending only on the spec, with no runtime
coupling to the engine. `ConnectorOrigin` is ADR-0097 §4 vocabulary and
`ConnectorState` is #3017 vocabulary; neither was ever engine-private in meaning,
only in location.

Nothing is renamed and no shape changes. `@objectstack/service-automation`
imports the four back and re-exports them from its index — the same names, from
the same entry point — so every existing importer compiles unchanged.
`ConnectorState` joins that re-export, which it should have been in all along: it
is a required field of the descriptor the index has always exported.

**The test fixture had already drifted, which is the concrete cost.** The
dispatcher's connector mock declared `{ name, label, type, actions }` and omitted
`origin` and `state` — both **required** on `ConnectorDescriptor`, and both the
fields a designer reads to tell a live declarative instance from a plugin one
(ADR-0097 §4), or a dispatchable connector from a degraded one that is listed
honestly rather than hidden (#3017). Nothing caught it, because an undeclared
return type cannot be checked against. The fixture is typed now, so it cannot
drift again, and a new test pins that `origin` / `state` / `degradedReason`
survive the hop through the route rather than only `name` and `type`.

Verified: `@objectstack/spec` **7089 tests / 272 files** (2 new contract tests),
`@objectstack/service-automation` **457 / 41**, `@objectstack/runtime`
**218 http-dispatcher tests** (1 new), `tsc --noEmit`, `pnpm lint`, the liveness
and empty-state gates, and the three generated-artifact gates — all clean.
