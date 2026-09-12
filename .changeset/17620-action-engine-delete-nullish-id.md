---
'@objectstack/runtime': patch
---

`ActionEngineFacade.delete` refuses a nullish id instead of silently skipping it

**Who this is for: untyped hosts.** A JS host, or a `registerAction` handler
whose context slot is still `(ctx: any)`, can hand `ctx.engine.delete()` a
nullish id — `delete('todo_task', null)`, or an array with a hole in it. Until
now the arm dropped that element on the floor: nothing refused it, nothing
warned, and the call **resolved as though the row had been deleted**. A silent
no-op on a destructive verb is the one failure an untyped caller has no way to
detect, which is why it is worth a line in your changelog rather than a shrug.

**What changes.** Every id now reaches the engine as written, and the engine's
own delete-dispatch predicate refuses a `where.id` that is not a truthy scalar:
the call rejects with `Delete requires an ID or options.multi=true` where it
used to resolve in silence. In the array form the refusal stops the loop where
the declared member doc already said a failure stops it — ids before the
nullish element are deleted, ids after it are untouched.

**If a host was leaning on the old behaviour**, filter before you call:

```js
const ids = candidates.filter((id) => id != null);
if (ids.length > 0) await ctx.engine.delete('todo_task', ids);
// `delete nothing` is the EMPTY ARRAY (it resolves, deleting nothing) —
// never a null id. An empty array is contract; a nullish id never was.
```

⛔ **No declaration moves, and this is not a correction of the `string | string[]`
widening that shipped just before it.** That declaration is accurate: it takes a
single id or an array of them, and under it **no typed caller could ever reach
the skipped branch** — the accept set it publishes has never admitted nullish.
The array form, its per-row semantics, its ordering and its empty-array case are
all unchanged and pinned as controls. What moves is only the runtime's
undeclared tolerance for a value three separate statements already excluded: the
published type, the member's own doc comment, and the spec-side pin that reads
«"delete nothing" is the EMPTY ARRAY, never a null id».
