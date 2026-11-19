---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

feat(spec): the Studio hook form offers a hook's declared `texts`, and `HookContext` declares `ctx.text`

Clause-②: yes
Metadata-protocol: none

- **Studio hook form.** `hookForm` gains a `texts` row beside `refusals`: a key-only record keyed by the snake_case key the hook's code asks for with `ctx.text`, each entry editing its `message` and `params`. An author editing a hook in the Studio can now write the `texts` the schema has accepted since 18.6.0, instead of going through the metadata API or the package source. The row's label and help text ship in all eleven metadata-forms locale packs of `@objectstack/platform-objects`. Nothing about what a hook may declare changes.
- **`HookContext.text`.** `HookContext` now declares `text?: (key: string, params?: Record<string, unknown>) => Promise<string>` (named `HookTextReader`), the call the runtime already binds on every path a hook runs on, declared the way `api` and `notice` are: `z.unknown()` at parse, a static cast for the type, optional because a context parsed without the runtime carries none. A typed handler no longer needs a local type to call `ctx.text`. `HookContextSchema.parse` now keeps a bound `text` instead of stripping it.