---
"@objectstack/lint": minor
"@objectstack/cli": patch
---

feat(lint): SDUI styling validator (ADR-0065)

`validateResponsiveStyles` — a pure `(stack) => Finding[]` rule wired into
`os validate` and `os compile`, so hand-authored and AI-generated pages are
held to the same bar (ADR-0019). Catches the deterministic ways a
`responsiveStyles` block silently fails: a styled node with no `id` (CSS can't
be scoped → dropped) is an **error**; warnings cover Tailwind-in-`className`
(silently dead in metadata), a smaller breakpoint with no `large` base, unknown
CSS properties, and unknown/typo'd design tokens. Quality/visual judgement
(is it ugly) is out of scope — that needs render + a VLM gate.
