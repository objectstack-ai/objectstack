---
"@objectstack/spec": minor
---

feat(spec): the ADR-0112 error envelope gains a producer-side `refusal` declaration, so a deliberate 5xx refusal can keep its caller-authored `message` (#16335)

`ApiErrorSchema` and `EnhancedApiErrorSchema` declare one new optional key, **`refusal: true`** — the producer's declaration that the 5xx it named is a deliberate REFUSAL whose `message` is authored for the caller, so the boundary keeps that message verbatim instead of withholding it. Director ruling, decision batch #58 (2026-09-06, option C): the refusal/fault distinction is a producer-side declaration on the published envelope — not a status heuristic and not a second allow-list.

The three cases are now documented side by side on the envelope's TSDoc:

- **undeclared 5xx** (no `status` on the throw) — unchanged: the leak heuristic decides per message.
- **declared fault** (`status >= 500` + `code`, nothing declared here) — unchanged, and still the DEFAULT: `message` is withheld from the body and logged for the operator.
- **declared refusal** (`status >= 500` + `code` + `refusal: true`) — new: `message` is kept verbatim, bounded exactly as a 4xx message is.

Purely additive: a producer that says nothing here gets exactly the previous behaviour. `true` is the only value — `refusal: false` fails parse instead of becoming a third state consumers would have to interpret. `userMessage` is orthogonal (end-user text; it never replaces `message`) and may ride the same envelope; the TSDoc reconciles this flag with the recorded reason `userMessage` is a text-carrying field rather than "a boolean beside `message`".

This is the spec half. The relay half — `declaredServerFaultAnswer` in `@objectstack/rest` reading the declaration at the single 5xx relay, and retiring the route-local patch on `/meta/:type/:name/references` — is #16146; until it lands, a declared refusal is still withheld at the wire.
