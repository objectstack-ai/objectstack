---
"@objectstack/types": minor
---

fix(types): let `sendError`'s `extra` carry `userMessage`, so a nested-envelope route can emit the #9934 user-facing channel (#12404)

`ApiErrorSchema` declares `userMessage` — the producer-side opt-in for "this
exact text is addressed to the END USER" (#9934; maintainer ruling 2026-08-19 on
objectui#5210, option 1), where **presence IS the marking** and a consumer that
sees the field renders it verbatim instead of substituting its generic string
(#3821 preserved by construction, for everything unmarked).

Two of the three doors already emit it: the flat `/data` door through
`withDeclaredUserMessage` (`@objectstack/rest`) and the dispatcher door through
`thrown.userMessage` (`@objectstack/runtime`). The shared nested-envelope writer
could not — `sendError`'s `extra` was typed
`Pick<ApiError, 'category' | 'httpStatus' | 'details' | 'requestId' | 'declaredCode'>`,
so passing the field was a **compile error** and every route answering the
nested envelope dropped it. Nothing invalid shipped, which is what made the loss
silent and one-directional: the author's deliberate, localized refusal text
gone, and a consumer told to read `userMessage` finding nothing there.
Declared-but-unemittable is a `declared = enforced` gap, closed here at the one
writer rather than per module.

Additive: `userMessage` joins the `Pick`. No existing call site changes, no wire
byte moves for any body already being emitted, and the contract's accept set is
untouched — the schema has always declared the field.

The channel is live on both ends, which is what makes this a repair rather than
a new declared-but-dead surface: a hook opts in at throw time (host-side, or a
metadata app's sandboxed body whose `e.userMessage` crosses the QuickJS boundary
through `SANDBOX_ERROR_PASSTHROUGH`), and `resolveThrownHttpError` already
carries it onto `ThrownHttpError` for every caller of the shared resolver.

⛔ Unlike `declaredCode`, this field hands the caller **no invariant to
re-derive**. `declaredCode`'s presence means demotion, so its caller passes
`demotedDeclaredCode(thrown)`; `userMessage`'s presence means only that the
producer opted in, which `declaredUserMessage` has already decided (a non-empty
string, or nothing). The caller passes `thrown.userMessage` straight through,
exactly as the dispatcher door does. That difference is why `extra` stays an
explicit `Pick` rather than being derived from `ApiError`'s optional fields: a
derivation would admit every future optional on the day it lands, with nobody
asked what obligation the channel hands the caller — and these two fields needed
opposite answers to exactly that question.

Pinned in `response-envelope.test.ts` by driving the real pipeline — a hook
refusal shaped like the one `hook-refusal-user-facing-marking.dogfood.test.ts`
drives, through `resolveThrownHttpError` — and by parsing the emitted body with
the real `ApiErrorSchema`, asserting the field is still on it *after* the parse,
paired with a control showing an undeclared sibling being stripped from the same
body. `ApiErrorSchema` is a plain `z.object` that strips undeclared keys, so a
`.success` assertion alone would have passed against a schema declaring nothing.
A blank marking is pinned ABSENT: the writer never invents a marked message for
a producer that wrote none.
