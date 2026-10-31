---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a live dataset query serves a derived measure built on another derived measure, and refuses a derived cycle with its path

Clause-②: no
Metadata-protocol: none

`DatasetSchema` accepts a derived measure whose `of` names another derived measure, and the currency page (`content/docs/data-modeling/currency.mdx`) describes one: "a measure built on it is judged the same way". `queryDataset` did not answer it:

- **Live query, native and ObjectQL strategies.** The derived operand was handed to the cube as a base measure and refused `INVALID_FIELD` / 400 ("Measure 'total_twice' on cube … aggregates field 'total_twice', which object … does not have"). It is now served: the executor follows `of` until it reaches aggregated measures and computes the derived measures dependencies first, at any depth, in `totals` too.
- **Draft preview.** It runs the same executor over seed rows and answered the derived operand as a row count, so a `ratio` over a derived `sum` read `1` where the answer was `150`. It now answers the same value as the live query.
- **A cycle.** A derived measure that reaches itself through `of` (`loop_a` → `loop_b` → `loop_a`; the schema refuses only the one-step self-reference) has no value at any depth. Selecting it, or a measure built on it, is refused `DATASET_INVALID` / 400 before anything is read, and the message names the cycle. Before, the live strategies refused it `INVALID_FIELD` as an unknown field and the draft preview served a number.

A derived measure whose operands are all aggregated measures is unchanged: same value, same columns.
