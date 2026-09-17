---
"@objectstack/cli": minor
---

fix(cli): `os build` says what the ADR-0046 package-docs collector did not read (#18170)

Package docs are collected from exactly one directory — `<config dir>/src/docs`
(ADR-0046 §3.2). Under an ADR-0130 multi-package layout, where every top-level
directory under `src/` is a package, a docs directory belongs to its package:
`src/<pkg>/docs/`. Move one there and the two conventions disagree in the worst
possible way — the collector reads nothing, the build prints its usual
`Collecting package docs (ADR-0046)...` step line, exits **0**, and writes an
artifact with no `docs[]` at all. Measured on `objectstack-ai/hotcrm` at
`590b095` (pin 17.4.0), `git mv src/docs src/sales/docs` as the only change:
four package docs gone, nothing in the output naming the loss.

`os build`, `os validate` and `os lint` now report one **warning** per
`src/<pkg>/docs/` directory that holds Markdown, through the doc-issue channel
they already share (text face and `--json` `warnings` alike):

```
⚠ src/sales/docs: src/sales/docs/ holds 4 Markdown file(s) that were NOT
  collected: package docs are read from src/docs/ only (ADR-0046 §3.2), so these
  are absent from the artifact's `docs[]` and from every book that includes them.
  Move them into src/docs/ (doc names carry the package namespace prefix, so
  packages do not collide there), declare them inline as `defineStack({ docs })`,
  or delete them if they are not package docs. Found: …
    rule: docs/uncollected-directory
```

**Nothing that built before builds differently.** The rule is `warning`, not
`error`, on purpose: an error fails the build, and a `src/<pkg>/docs/` directory
is not declared anywhere the build can read — the collector can only *guess* it
was meant as ADR-0046 docs, and refusing a tree that is green today on a guess
is worse than the silence it replaces. What changes is that the loss is now
audible. Existing behaviour on the flat layout is byte-identical: `src/docs/` is
never itself flagged, and a subdirectory under it is still the
`docs/flat-directory` error it always was.

**What this deliberately does NOT do**: it does not collect those files.
Reading package docs from each package directory widens the accepted set and
needs a decision this change does not make — an ADR-0130 D4 artifact registers
per package, so per-package docs have to say which package body they belong to,
and where they attach in an option-B artifact is open. The card
(objectstack-ai/objectstack#18170) offers both repairs and names the loud
failure as its minimum; that is the half delivered here.
