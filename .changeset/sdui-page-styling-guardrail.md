---
"@objectstack/lint": minor
"@objectstack/cli": minor
---

Add the source-page styling guardrail (ADR-0065): `os validate`/`os build` now flags Tailwind `className` in `kind:'html'`/`kind:'react'` page source, which silently produces no CSS because the build never scans authored metadata. New `validatePageSourceStyling` rule with an actionable inline-style/`hsl(var(--token))` fix; also corrects the react-blocks contract, the objectstack-ui skill, the layout-dsl docs, and ADR-0080/0081 away from the "HTML + Tailwind" framing.
