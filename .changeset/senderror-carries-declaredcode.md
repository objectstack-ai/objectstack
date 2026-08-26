---
"@objectstack/types": minor
---

fix(types): let `sendError`'s `extra` carry `declaredCode`, so a nested-envelope route can emit the ADR-0112 open channel (#11719)

`ApiErrorSchema` has declared `declaredCode` since #9106 — the open,
author-authored channel that carries a metadata app's own `.code` verbatim when
the spelling is not a member of the closed `code` vocabulary. ADR-0112's
2026-08-17 amendment rules that demote **platform-wide**, and #9232 extended it
to the flat `/data` door, which emits the pair today.

The shared nested-envelope writer could not. `sendError`'s `extra` was typed
`Pick<ApiError, 'category' | 'httpStatus' | 'details' | 'requestId'>`, so
passing a demoted spelling was a **compile error** and every route answering the
nested envelope dropped it. Nothing invalid shipped — the closed `code` still
carried the member derived from the status — which is exactly what made the loss
silent and one-directional: the author's spelling gone, and a consumer told by
the ADR to read `declaredCode` finding nothing there. Declared-but-unemittable
is a `declared = enforced` gap, closed here at the one writer rather than per
module.

Additive: `declaredCode` joins the `Pick`. No existing call site changes, no
wire byte moves for any body already being emitted, and the contract's accept
set is untouched — the schema has always permitted the field.

⛔ Presence still MEANS demotion, and the writer does not re-derive that. The
caller passes `demotedDeclaredCode(thrown)` (`@objectstack/types`), exactly as
the flat door's `thrownCodeFields` does; that helper answers `undefined` when
the producer's spelling is already the vocabulary member sitting in `code`, so a
registered refusal never carries two spellings of one fact. Vocabulary and
position stay two decisions (#9232).

Pinned in `response-envelope.test.ts` by driving the real pipeline — a
sandbox-shaped throw carrying a tenant-authored `.code` through
`resolveThrownHttpError` and `demotedDeclaredCode` — and by parsing the emitted
body with the real `ApiErrorSchema`, asserting the field is still on it *after*
the parse. `ApiErrorSchema` is a plain `z.object` that strips undeclared keys,
so a `.success` assertion alone would have passed against a schema declaring
nothing.
