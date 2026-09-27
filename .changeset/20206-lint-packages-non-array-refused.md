---
"@objectstack/lint": minor
---

`packages/lint`'s four `stack.packages` readers (plus a fifth added by #20208 after this ruling's own site census) now refuse a PRESENT non-array `packages` — `{}`, `0`, `'x'`, or a keyed object — the same way `@objectstack/core`'s `resolveArtifactPackageOrder` already does, instead of silently reading it as "no packages" (#20206, ruling A on #15293, comment 5634034754).

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an already-malformed `packages` value is refused rather than converted; no key, export or stored value moves, and nothing in this repo emits the shape today -->

- **What changes**: `validateObjectReferences`, `validateTranslationReferences` and `validateMappingTargetFields` (the three public `@objectstack/lint` functions these readers sit behind) now throw an `INVALID_ARTIFACT_PACKAGES` error (ADR-0112, `status: 422`) instead of returning findings, when the stack they are handed carries a `packages` key that is present but not an array. `os validate` / `os lint` / `os build` surface it as a refusal on stderr (and in `error`/`code` under `--json`) instead of reporting the stack as clean.
- **What does not change**: an absent `packages`, and `packages: null`, are still read as "no packages" — unchanged, and #19926's surface, not this one. A well-formed `packages[]` array is read exactly as before, junk entries dropped exactly as before.
- **Fix**: write `packages` as an array of `{ manifest: … }` entries, or omit the key entirely for a single-package stack.
