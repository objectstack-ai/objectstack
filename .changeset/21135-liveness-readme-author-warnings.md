---
"@objectstack/spec": patch
---

Liveness ledger README: the "Author warnings" section now describes the model the liveness lint ships. A `dead`, `live-elsewhere` or `experimental` verdict warns on its own, and `authorWarn` only opts a `planned` row in.

Clause-②: no

- The section said warnings were opt-in per ledger row, and that only `experimental` warned without the marker. That stopped being true when the lint made a `dead` or `live-elsewhere` verdict warn on its own. The section now has one table of which verdicts warn, and under which rule id.
- `authorHint` no longer "falls back to `note`". Every warning shows the row's `authorHint`, or else the verdict's default hint. The `note` never reaches an author.
- Rule 1 now talks about the verdict, not the marker. Grading a row `dead`, `live-elsewhere` or `experimental` warns every author who sets the key, and fails their `os lint --strict` / `os validate --strict` run. No marker keeps it quiet, so a benign display key is measured against the designer-previews ruling before it is graded `dead`.
- Rule 2 (booleans) now covers any key whose schema default materializes. It no longer points at an `_authorWarnSkipped` marker, which no ledger carries.
- The coverage paragraph states the walk's real reach: the types it visits, one level of `children`, and that a governed type it does not visit warns no author through this lint.
- Two sentences elsewhere in the README said a `dead` row needs `authorWarn` to warn. Both are corrected the same way.
- ⛔ Documentation only: no ledger row, schema, export or lint behaviour changes.
