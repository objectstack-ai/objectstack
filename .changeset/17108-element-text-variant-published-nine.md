---
'@objectstack/spec': minor
---

`element:text.variant` accepts the nine values objectui's text node publishes — `h1`–`h6`, `body`, `caption`, `overline` — and still accepts `heading` and `subheading` (#17108).

Clause-②: yes (widening)

Release 1 of 2 for the objectui#7450 convergence (director batch #71, 2026-09-07, maintainer verbatim 「其他同意」), split across two releases by the maintainer's decision of 2026-09-09, option B. This release is **additive only**: the accepted set grows by seven and nothing is refused that was accepted before, so an out-of-repo author can converge on a released pin before any spelling stops working.

Measured on the 17.3.0 declaration, per value, through `ElementTextPropsSchema.safeParse`: `h1`–`h6` and `overline` were refused with `invalid_value`; they are accepted now. `heading`, `subheading`, `body` and `caption` were accepted and are accepted now. A value outside the eleven — `small` — is still refused with `invalid_value` at path `variant`, so the enum remains a closed set rather than having stopped judging `variant` at all.

- **`.optional().default('body')` is kept, deliberately.** An `element:text` node parsed without a `variant` still materialises `variant: 'body'`, exactly as before. Absence is the one thing a widening must not move, and the `ui:text` side of the platform deliberately does *not* synthesise `body` for an absent `variant` (objectui#6942) — that asymmetry is pre-existing and is left where it was.
- **⛔ Nothing is retired.** `heading` and `subheading` become named refusals carrying migration hints in **release 2**, which is a separate card and is blocked on a value-level retirement mechanism that does not exist yet: `retiredKey()` and ADR-0087 D2 retire a *key*, not a *value*. Authors who want to move early can write `h2` for `heading` and `h3` for `subheading`; neither spelling stops working in this release.
- **No renderer changes here.** `element:text`'s renderer, its designer inspector options and its i18n rows are objectui's, on the released pin, and land on objectui's side of the sequence.

Generated projections follow the declaration: `api-surface-declarations/ui.txt` gains the seven members on `ElementTextPropsSchema` and on `ComponentPropsMap['element:text']`, and the `content/docs/references/ui/component.mdx` property table widens. `check:api-surface` reports nothing removed or narrowed.
