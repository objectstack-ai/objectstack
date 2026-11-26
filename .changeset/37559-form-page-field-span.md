---
'@object-ui/console': patch
'@object-ui/plugin-form': patch
---

fix(console): the named-form page (`/forms/NAME`) sizes each field from its `span`, not only its `colSpan`

Clause-②: yes (widening)
Metadata-protocol: none

A form field with `span: 'full'` now takes the whole row of its section, and with the default `span: 'auto'` a textarea, markdown, html or rich-text field, or a file or image field whose object field declares `multiple: true`, takes the whole row too. An authored `colSpan` still wins over that default, clamped to the section's column count. The page used to read `colSpan` alone, so these fields rendered one cell wide. The width comes from the same resolver the record form uses; `@object-ui/plugin-form` now exports `resolveColSpan` from both the package root and the side-effect-free `@object-ui/plugin-form/core` subpath, so the console can reach it without loading the form renderers.
