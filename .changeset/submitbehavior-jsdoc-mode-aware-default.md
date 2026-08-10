---
"@objectstack/spec": patch
---

docs(spec): state `submitBehavior`'s default as mode-aware, not a single fixed kind (#7441)

The TSDoc block above `FormViewSchema.submitBehavior` in `packages/spec/src/ui/view.zod.ts`
still read `` `thank-you` (default) — show a confirmation panel``, which the maintainer's
2026-08-10 ruling on #7245 makes false for the internal path: `thank-you` stays the default
only on the public `/console/f/:slug` path, while the internal `/console/forms/:name` path
— where `type: 'form'` actions send operators — now defaults to redirecting to the record
that was just created. An explicit `submitBehavior` wins in either mode.

Rewritten to state both defaults and the reasoning behind each, mirroring the contract
already landed in `content/docs/protocol/objectui/actions.mdx` and `content/docs/ui/forms.mdx`
(PR #7417). The schema itself is unchanged: `submitBehavior` stays `.optional()` with no
`.default()`, and its `.describe()` string (`'Post-submit behavior'`) is untouched — only
the source comment was wrong, and only the source comment changes.

No generated output changes: `gen:docs` never renders property-level TSDoc, so `check:docs`
reports all 231 files still in sync (same measurement PR #7444 made for the same reason).
