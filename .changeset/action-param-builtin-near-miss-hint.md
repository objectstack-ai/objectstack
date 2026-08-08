---
"@objectstack/spec": patch
---

fix(spec): action-param rejection names the built-in a "differs by one underscore" key meant

`validateActionParams` (ADR-0104 D2) rejected every undeclared key with the
same sentence — `Unknown action param "selectedIds" — not declared on this
action` — including keys one leading underscore away from a built-in
(`ACTION_PARAM_BUILTIN_KEYS`: `recordId` / `objectName` / `_selectedIds`).
That sentence is true, and its only actionable reading is false: the reader's
next step is to declare the key on the action, and a built-in is precisely the
key that **cannot** be declared. #5568's reporter walked that road to its end
on `params.selectedIds`, concluded that REST carried no legal shape for a bulk
selection at all, and opened a platform issue — while `params._selectedIds`
was live the whole time.

The `unknown_field` message now appends a near-miss hint when `'_' + key` or
`key` minus its leading underscore is in the allowed built-in set:

```
Unknown action param "selectedIds" — not declared on this action. Did you mean
the built-in "_selectedIds"? Built-in params are never declared on an action —
an aggregate bulk dispatch (`execution: 'aggregate'`) injects every selected
record id under it, and a handler reads `ctx.params._selectedIds`.
```

The origin sentence is per built-in, because the three have three different
producers: `recordId` / `objectName` are merged into the bag server-side by the
dispatcher, `_selectedIds` arrives from the renderer's aggregate bulk dispatch.
A key reached through a custom `builtinKeys` override gets the generic
"the dispatcher supplies it".

**Message copy only — the verdict does not move.** The key is rejected before
and after, the accepted set is unchanged, and an unknown key that is *not* a
near-miss keeps today's message byte for byte (the match is one leading
underscore, not a similarity score). This is not a second acceptance channel
for `selectedIds`: the contract still has exactly one spelling,
`params._selectedIds`.
