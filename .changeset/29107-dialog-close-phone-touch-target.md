---
'@object-ui/components': patch
---

fix(components): the shared Dialog close button is a 44 px touch target at phone width

Clause-②: no
Metadata-protocol: none

Below the `sm` breakpoint the close button that `DialogContent` draws in its top-right corner was the bare 16 px glyph, a 16 x 16 px tap target. It is now a 44 x 44 px box with the 16 px glyph centred in it, 4 px from the corner. From `sm` up its classes are unchanged, so desktop dialogs look and measure as before. Every dialog built on `DialogContent` gets it, including the action parameter dialog and the command palette. `dialog.tsx` is a Shadcn-synced file, so the change is declared in `ui/scripts/shadcn-local-patches.mjs` and re-applied on every `pnpm shadcn:update`.
