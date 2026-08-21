---
'@objectstack/spec': patch
---

Name the real per-tier styling primitive in `PageSchema`'s `kind` and `source`
descriptions, replacing the "JSX/HTML+Tailwind" framing that ADR-0080's 2026-06-30
amendment retracted on styling.

A page's `source` is runtime metadata, so the console's build-time Tailwind never
scans it — authored utility `className`s silently produce no CSS. The descriptions
now say what each tier actually styles with: `kind:'html'` via the registered
components' structured props plus a JSON `style` object with `hsl(var(--token))`
theme colors, `kind:'react'` via inline `style` with the same token colors, and
neither with Tailwind classes.

Text-only correction, no schema shape or acceptance change — the accepted page set
is unchanged, and every other claim in the two descriptions survives verbatim
(parse-never-execute, the compiler package per tier, `source` authoritative over
`regions`, the ADR-0081 `OS_PAGE_REACT=off` gating).

- `packages/spec/src/ui/page.zod.ts` — the `kind` and `source` `.describe()`
  strings and the `source` TSDoc block, which regenerate
  `content/docs/references/ui/page.mdx`.
