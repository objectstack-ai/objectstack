---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

ADR-0081: split the AI page-authoring surface into honest tiers.

- `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
  parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
  `'react'` is the real-React tier (executed at render by
  `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
  capability that **defaults ON** (the platform trusts reviewed, draft-gated
  authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
  env toggle. The completeness gate now requires `source` for all three kinds.
- `@objectstack/cli` console serving injects the disable global into the served
  HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
- `validate-jsx-pages` lints `html`/`jsx` (constrained parse) and intentionally
  skips `react` (real JS, not constrained JSX).
