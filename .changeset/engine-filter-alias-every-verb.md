---
"@objectstack/objectql": patch
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

fix(objectql): every engine verb folds `filter` → `where` — `delete({filter})` no longer empties the object (#4346)

`ObjectQL.find()` folded the deprecated `filter` alias onto `where`, with a
comment explaining why it must: the driver AST understands `where` only, so an
unfolded `filter` is not a narrower query, it is **no query**. The five sibling
verbs never got that fold.

Measured against a real engine + driver, three rows (`a: open`, `b: done`,
`c: done`), predicate passed as `filter`:

| call | before | after |
|---|---|---|
| `find({filter: done})` | `[b, c]` ✅ | unchanged |
| `findOne({filter: done})` | **`a`** — a row that does not match | `b` |
| `count({filter: done})` | **3** | 2 |
| `aggregate({filter: done, …})` | whole object | matched rows |
| `update(data, {filter: done, multi})` | **all three rows rewritten** | only `b`, `c` |
| `delete({filter: done, multi})` | **object emptied** | only `b`, `c` deleted |

The write paths reached `driver.updateMany` / `deleteMany` with
`ast.where === undefined`, which every driver reads as "no predicate".

**Reachable from the documented authoring surface.** `ScopedContext` — the
cross-object API handed to L2 hook bodies as `ctx.api.object('x')` — forwards
its argument bag verbatim to these methods, every parameter typed `any`, and
the spec's own hook TSDoc taught `users.findOne({ filter: { role: 'admin' } })`.
That example is corrected to `where` here. The deprecated
`DataEngine{Query,Update,Delete,Count}OptionsSchema` also still declare `filter`
for exactly these verbs, so "callers should not pass it" was never the contract.

The fold is now one call per entry point to the shared `foldQueryAliasSlots` +
`ENGINE_FILTER_ALIAS_SLOTS` table from `@objectstack/spec/data` (#3795's
machinery), rather than five more copies of `find`'s guard. Options bags are
copied, never mutated under the caller.

**Same pass, the sixth alias pair.** `top` is declared as "Alias for limit
(OData compatibility)" on both `QuerySchema` and `EngineQueryOptionsSchema`, yet
`protocol.ts` folded it **unguarded** (`options.limit = Number(options.top)` —
the alias overwriting the canonical key) while `engine.find` kept `limit`. So
`{top: 1, limit: 3}` resolved to 1 over HTTP and 3 through a direct engine call
— #3795's divergence on the one pair its scope note excluded. Both now read
`ENGINE_QUERY_ALIAS_SLOTS`. `top` stays a declared AST key (unlike the five
deprecated RPC aliases it is **not** dropped from parsed output — that would be
a breaking type change deserving its own decision); it simply has one
precedence now.

**Behaviour changes**, all in the direction of one answer: a predicate passed as
`filter` now actually applies on every verb (if you were relying on
`delete({filter})` deleting everything, it will now delete what you asked for),
and two spellings of one slot carrying **different** values are refused
(`400 INVALID_REQUEST`) rather than silently resolved — the #4181 rule, applied
at the engine layer too. A single spelling, and redundant identical spellings,
behave exactly as before.
