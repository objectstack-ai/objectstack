---
"@objectstack/spec": minor
---

`ToolExecutionContext.confirmedBlueprintIdentity` — the consent digest a route-owning layer stamps on a confirm replay — is now declared in the protocol instead of in one consumer's augmented type (#15937).

Clause-②: yes (widening) — one new OPTIONAL member on a published interface, so the shape a consumer writes against grows. Nothing previously admitted is refused, no member is renamed or retired, and no producer is required to write it. Contract-review tier.

`packages/spec/src/contracts/ai-service.ts` declares the tool-execution context a tool handler may rely on. A published handler in `objectstack-ai/cloud` — the `apply_blueprint` authorization gate — already makes a matching blueprint-identity digest one clause of the decision to build a whole app (cloud#1954 / cloud PR #2005), but the member it reads was declared only on cloud's own augmented `ToolExecutionContext` and reached by a structural cast. The protocol is this project's baseline, so a field a handler authorizes on is declared here.

- **The member is optional and fail-closed.** `undefined` means "no confirmed identity on this turn" and authorizes nothing — the same reading `actor` and `isSystem` already carry (#2991): absence is never a grant. The docblock states it, and the type enforces the handler-side half of it, because a read of `string | undefined` does not compile into a path that assumes a confirmation.
- **Provenance is part of the declaration**, in the shape `userMessageText` already carries: populated by whichever layer owns the agent route (cloud, post-cloud ADR-0025), only ever by in-process server code on that route, and never derived from a request body, a tool argument or the transcript.
- **Nothing in this repository reads it yet**, and nothing here changes behaviour: this is the declaration half. Deleting cloud's augmentation and replacing its cast with the typed read is a cloud follow-up, blocked on this field being published and pinned.
- **The contract is now asserted.** `confirmed-blueprint-identity-contract.pin.test.ts` pins that the member lives on `ToolExecutionContext`, reaches a handler through `ChatWithToolsOptions.toolExecutionContext`, stays optional, and is typed `string` — each negative leg paired with a positive one on the same helper, so a leg that stops detecting anything turns the test-layer type-check red rather than passing quietly.
