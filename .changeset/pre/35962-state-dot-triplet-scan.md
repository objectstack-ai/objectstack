---
'@object-ui/components': patch
---

fix(ui): the state-machine chip's dot shows the theme grey when its option has no colour

Clause-②: no
Metadata-protocol: none

- In the metadata viewer's state-machine panel, a state whose picklist option declares no `color` showed an empty gap instead of its dot. The fallback read a bare `var(--muted-foreground)`, which holds an HSL triplet rather than a colour, so the browser dropped the declaration. The fallback dot now paints with the `bg-muted-foreground` utility, so it follows the light and dark themes, and a declared option colour reaches the dot as a CSS custom property that a static utility consumes, as the styling rules require.
