---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s hook reference (`references/data-hooks.md`) now says that `input` and `ctx` are already bound in an action body's `(async (input, ctx) => { … })` wrapper, shows the refused redeclaration (`const input = ctx.input || {};`, `let ctx`) with its rule id `action-body-does-not-compile`, and links the hook-body compile paragraph for the commands, the `422 INVALID_METADATA` save and the fix. That paragraph's suggested local is now `const data = …`, a name no wrapper binds. The file stays inside its token ceiling by dropping two restatements.
