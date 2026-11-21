---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s hook reference (`references/data-hooks.md`) now says that `input` and `ctx` are already bound in an action body's `(async (input, ctx) => { … })` wrapper, shows the refused redeclaration (`const input = ctx.input || {};`, `let ctx = …`) with its rule id `action-body-does-not-compile`, the commands and the runtime save that report it, the fix, and the `os explain` pointer.
