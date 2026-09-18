---
"@objectstack/cli": patch
---

`os build` / `os compile` — the package-docs step line is printed **after** the collection it announces and carries the count, so a build that collected nothing no longer reads identically to one that collected four documents (#18432).

```
  → Collecting package docs (ADR-0046)...              ← before: every run
  → Collecting package docs (ADR-0046)... 0 collected  ← after: this run found none
  → Collecting package docs (ADR-0046)... 4 collected
```

The sentence was unconditional and was emitted **before** `collectAndLintDocs` ran, so the reassurance it offers — the docs step ran, and it found your docs — was true of every run including the ones that found nothing at all. This is the reassurance half of #18170: an exit-0 build carrying the usual progress line is the shape every reader trusts. #18428 landed the audible half, where an uncollected docs directory speaks for itself.

- **The docs step now reports what it collected, not what it attempted.** A project whose `src/docs/` is empty, or whose docs directory moved into a package under an ADR-0130 layout, prints `0 collected` here instead of the same sentence a successful collection prints.
- **The printed number is the artifact's `docs` set**, the same `docsResult.docs` the build writes into `dist/objectstack.json` — pinned from both ends (absent directory, empty directory, two docs) in `packages/cli/test/build-docs-step-count.e2e.test.ts`, because a test that only asserted the sentence was printed passes on the defective tree.
- **`--json` is unchanged**: the line has always lived behind `if (!flags.json)` and the machine face still emits one JSON document with no step text.
