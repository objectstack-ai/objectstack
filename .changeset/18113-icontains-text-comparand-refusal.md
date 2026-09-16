---
"@objectstack/spec": minor
---

`@objectstack/spec/data` publishes the case-insensitive-contains **text-comparand door** — `isRefusedTextComparand(target)` and `textComparandRefusalReason(field, operator, target)` — so every face reads one implementation of a refusal the package already declared as data (#18113, objectui#9048 ruling D).

`FILTER_TEXT_CASES` has carried two REJECTION rows for that operator since #5701 — an empty comparand and a non-string one, both `code: 'INVALID_FILTER'`, both `mustMention: ['$icontains']` — but only as cases a backend is *checked against*. Every face that honoured them wrote its own copy of the discrimination and its own wording, which is how the same authored filter came to be refused in one dialect and lowered onto the wire in another. The rule now lives with the producer of the rule.

- **`isRefusedTextComparand(target)`** answers `true` for exactly those two shapes. It answers `true` for `undefined` as well: a vocabulary with an "absent" the `$` dialect does not have (a stored view rule whose operator takes no comparand) must test for absence **before** this door — that carve-out is the caller's, not a third row.
- **`textComparandRefusalReason(field, operator, target)`** returns the CONTRACT half of the message: **no leading capital, no trailing period, no envelope**, so each face seats it in its own sentence — a matcher that has a row to exclude logs it, a producer that has none throws it. ⛔ No new error code: `INVALID_FILTER` is declared and already in the ADR-0112 ledger.
- **`operator` is the spelling that ARRIVED** (`$icontains` from a `$`-dialect filter, `icontains` from the infix/view vocabulary), never a canonical substitute — telling an author about a key their dialect cannot contain is the misdirection this door exists to end.
- ⚠️ **Consequence for the infix dialect**: `mustMention` is spelled `$icontains` because the published rows' filters are, so for an arriving `icontains` the reason names what arrived and does **not** carry the `$`-dialect token. The face serving that vocabulary names the `$` twin in its own tail. Pinned in both directions in `filter-text-comparand.test.ts`.
- **The message bytes are the contract, not prose.** They are the bytes two shipped faces already emit byte for byte; `mustMention` is what makes a reword a different failure to honour the same row, and a transcription pin catches the reword `mustMention` cannot. ⛔ Change them only by changing the rows they answer.

Additive: no existing export changes, no behaviour moves. `describeComparand` — the guard that keeps a BigInt or a cyclic comparand from making `JSON.stringify` throw *inside* the refusal — travels with the reason as a module-internal helper and is deliberately not published; exporting it is a published-surface decision for the PR that needs it.
