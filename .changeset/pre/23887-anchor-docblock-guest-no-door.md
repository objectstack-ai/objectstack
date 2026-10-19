---
'@objectstack/spec': patch
---

Clause-②: no

The docblock on `EVERYONE_POSITION` and `GUEST_POSITION` no longer says that packages suggest
bindings to both audience anchors. It now reads that packages suggest bindings to `everyone` at
install time and the admin confirms each one, never auto-bound, and that no door binds a
permission set to `guest` until ADR-0138 D3 item 5's bind door is built, an act of the
environment's administrator and never of a package. The docblock ships in the package's
`src/**/*.zod.ts` files and in the JSDoc of `dist/*.d.ts`, so it is the hover text an author or an
AI reads on the two constants. No key, schema, export or accepted value changes.
