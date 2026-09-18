---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — a `$between` range now requires two endpoints that are present and non-empty. A blank bound (`''` or an absent `undefined` bound, at either side) is refused at the authoring door, and the refusal names the blank side (#18012).

Clause-②: yes

Maintainer ruling A on decision batch #146 item 5, 2026-09-17 「146 同意」.

## What changed, and why it is a new rule rather than a repair

`FieldOperatorsSchema.safeParse({ $between: [1, ''] })` answered `success: true` — measured on the card against spec 17.4.0 and re-measured on `main` before this change. That acceptance was **conformant**: the endpoint contract shared by both bounds says verbatim that "Each endpoint is a number, a Date, or a string", and the empty string is a string. So this narrows a published face by adding a rule to it, rather than pulling code back to a declaration it was already violating.

What made the acceptance wrong is the other half of the same contract — "Closed interval [min, max]" — which no backend can honour against a blank. `driver-sql` binds the blank into `whereBetween`; the JS matchers compare it as a value. Either way the range stops bounding on that side **while still reading as a complete two-element range**, so the query runs with one meaningless boundary and no signal at any layer. The reference matcher was already taught to survive the `null` form of exactly this (a bounded range answered every valued row, because both of the arm's comparisons are false against a missing bound); the door that admitted it was never addressed.

The only producer ever measured is a UI builder padding a **half-typed** pair so a length-based completeness check passes it. Nobody writes a blank bound on purpose — which is why it is refused rather than given a published meaning.

```
FROM  FieldOperatorsSchema.safeParse({ $between: [1, ''] })
      -> { success: true }                       // a half-filled range, green all the way
                                                 // to the driver

TO    FieldOperatorsSchema.safeParse({ $between: [1, ''] })
      -> { success: false,
           issues: [{ code: 'custom', path: ['$between', 1],
                      message: 'A blank value is not a valid $between endpoint at index 1
                                (the MAX bound). …' }] }
```

## Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `{ $between: [1, ''] }` | `{ $between: [1, 100] }` — the upper bound you meant, written out |
| `{ $between: ['', '2026-12-31'] }` | `{ $between: ['2026-01-01', '2026-12-31'] }` — the lower bound you meant |
| a range that was only ever bounded on ONE side | `{ "$gte": min }` or `{ "$lte": max }` — a one-sided bound is not a range |

**The one-line fix: write the bound that is missing, or — if only one side was ever meant — drop `$between` and write that side as a scalar comparison.** ⛔ Not mechanically convertible: the bound the author did not type is not recoverable from the one they did, so this ships as an ADR-0087 D3 structured TODO and **no D2 conversion**. Both of the two readings a conversion could take are wrong — dropping the operator deletes a constraint the author wrote and silently WIDENS the result set, and treating the blank side as unbounded invents a filter nobody authored.

<!-- adr-0087: registered filter-between-blank-endpoint-refused -->

## What does NOT change

- **Arity.** A one-element or three-element `$between` was already refused, and still is, by the tuple's own contract. This rule is about a two-element range one of whose elements means nothing.
- **`null` bounds.** Already refused since 2026-08-31, and they keep **their own** message, which prescribes the null predicate — an author who wrote `null` was reaching for absence, not for a bound. Two blank spellings, two intents, two remedies.
- **Falsiness.** `{ $between: [0, 100] }` and `{ $between: ['0', '9'] }` parse exactly as before. The rule is blankness, not falsiness.
- **Whitespace-only endpoints** are deliberately **not** judged. The ruling is the empty string; widening the refusal past it would narrow a published face further than the ruling did.
- **The set slots.** `{ $in: ['', 'won'] }`, `{ $nin: [''] }`, `{ $eq: '' }` and `{ $gte: '' }` are untouched — an empty string is a legitimate stored VALUE, and only an interval ENDPOINT is judged here.
- **Stored documents.** The read path does not re-validate stored rows, and the stored-row conversion pass neither validates nor drops anything, so no stored view becomes unreadable. What changes is that **re-saving** one is refused, at the endpoint's own path, with the blank side named.
- **The published export surface.** No export is added, removed or renamed; the refusal rides the existing endpoint factory that both the documentation copy (`RangeOperatorSchema`) and the enforced copy (`FieldOperatorsSchema`) already share, so the two cannot drift.
