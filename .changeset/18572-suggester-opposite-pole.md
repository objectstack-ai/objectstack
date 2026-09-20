---
'@objectstack/spec': patch
---

The unknown-key suggester no longer answers an axis-silent key with one arbitrary end of a range — `dateField` on a calendar, timeline or gantt config is told about `startDateField` **and** `endDateField` instead of being sent to the end of the event (#18572).

Clause-②: no

`findClosestMatches` ranks by edit distance and nothing else. On a shape that declares both ends of a range, a key naming neither end is therefore answered with whichever end is spelled more cheaply — re-derived here rather than taken from the card:

```text
authored `dateField`  (9 chars, budget max(2, 9/3) = 3)
  -> `endDateField`     distance 3   INSIDE the budget   <- answered
  -> `startDateField`   distance 5   outside the budget  <- unreachable
```

`end` is a three-letter token and `start` a five-letter one; that spelling accident was the whole reason the protocol told an author to bind the **end** of the event. And the suggested key is a declared key the runtime honours, so an author who copied the remedy got a document that **parses**, with the axis silently on the wrong date. ⛔ Nobody had declared that mapping — a generic fuzzy matcher picked one sibling out of two.

- **The fallback's answer is screened; a declared `aliases` entry never is.** When the guessed candidate carries an axis token the authored key does not, and the shape also declares its opposite-pole sibling, the rename is replaced by a prescription naming both ends: *"`dateField` does not say which end of the range it binds, and this surface declares both `startDateField` and `endDateField` — opposite ends of one axis. Write the one you mean: both parse, so guessing binds the wrong end silently."* A human-written alias is a statement about one spelling and outranks this; only a coin flip is replaced. `this field` keeps answering `length` with `maxLength` exactly as it declares.
- ⛔ **No alias was added and the accepted key set does not move.** `dateField` was refused before this change and is refused after it; what changed is the sentence the refusal carries. Naming both ends rather than picking one is the answer `field.zod.ts` already writes by hand for `visible` — 「the two answers have opposite polarity … Naming both is the only answer that cannot be acted on wrongly」 — generalised to the keys nobody thought to enumerate, which is the set a fuzzy suggester answers.
- **The guard separates an omission from a typo, and that condition was measured.** It fires only when the authored key is at least as close to the candidate MINUS its axis token as to the candidate itself. Without it `axLength` — one dropped character in `maxLength`, with `minLength` declared beside it — would lose a perfectly good suggestion. With it, `axLength` reads as the typo it is (distance 1 vs 2) and `dateField` as the axis-silent key it is (distance 3 vs 0).
- **Census, not just the filed case.** Over 136 registered `strictObject` surfaces the trap occurs four times, all four fixed here: `dateField` on the calendar, timeline and gantt configs, and `baselineField` on the gantt config (`baselineStartField` / `baselineEndField`). The axis vocabulary is held to the shapes: `alias-integrity.test.ts` now fails on an axis row no surface declares both ends of, the same dead-entry judgement it already applies to `aliases` and `guidance`.
