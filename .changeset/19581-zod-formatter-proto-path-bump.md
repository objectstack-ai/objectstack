---
"@objectstack/cli": patch
"@objectstack/core": patch
"@objectstack/driver-turso": patch
"@objectstack/mcp": patch
"@objectstack/metadata": patch
"@objectstack/metadata-core": patch
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/spec": patch
---

**The declared `zod` floor moves from `^4.4.3` to `^4.6.1`**, because on zod below 4.6.1 the three standard error formatters — `z.treeifyError()`, `error.format()` and `error.flatten()` — cannot render a refusal these packages actually emit (#19581).

Clause-②: no

**What breaks below the new floor.** All three formatters walked an issue's `path` by reading `curr[el]` and testing it for truthiness before creating a node, so a path element naming a member of `Object.prototype` was answered by the prototype and no node was ever created. Two different failures follow:

| path shape | what happened on `^4.4.3` |
|:---|:---|
| terminal element (`['assignments','__proto__']`, `['x','toString']`) | the inherited member is adopted as the node, then `node._errors.push(...)` runs on it — `TypeError: Cannot read properties of undefined (reading 'push')` |
| non-terminal element (`['__proto__', …]`) | the walk continues **into** `Object.prototype` and writes the next segment onto it — the message is silently dropped from the returned tree and the process gains a global prototype key |

**Why it reached this platform's consumers.** `@objectstack/spec` refuses a `__proto__` key on its open-key authoring surfaces, and that refusal's issue path is `['assignments','__proto__']` — precisely the terminal shape. Anything that formatted one of these refusals for display crashed on it, and the crash was in the formatter, not in the guard. The guards themselves are unchanged and still necessary: 4.6.1 still drops a `__proto__` key from `z.record()` and `.catchall()` output, which is what they exist to refuse.

**What an upgrading consumer must do.** Nothing, if `zod` is resolved through these packages — the floor does it. A consumer that pins `zod` itself must move that pin to `^4.6.1` or higher; a pin below it reintroduces the crash on any refusal whose path names an `Object.prototype` member, including the ones these packages emit.

`@objectstack/lint` also moves, but only in `devDependencies`, so nothing it publishes changes for a consumer and it takes no release here.

## The second half the floor move needs: an unknown key refuses TERMINALLY again

From zod 4.5.0 an `unrecognized_keys` issue carries `continue: true`, so it no
longer aborts the shape that raised it. Two things follow, and both were
measured on this package with the same bodies on 4.4.3 and 4.6.1:

1. **A closed shape's own refinements now run after the refusal**, adding a
   second complaint that contradicts the first.
2. **A union containing that shape loses its envelope.** zod's
   `handleUnionResults` returns a single non-aborted member's issues
   *unwrapped* instead of raising `invalid_union`, so the union's message
   becomes whichever branch zod judged closest.

At `PUT /api/v1/meta/view` that turned a retired-value refusal into the wrong
branch's prescription. Writing `type: 'page'` on a ViewItem answered:

```
Unrecognized key(s) on this view container: `viewKind`, `config`.
  • `viewKind` belongs to a single VIEW, not to the container. Wrap it: …
```

— naming neither `page` nor its removal. It now answers, as it did before:

```
config.type: 'page' was removed from the list-view `type` enum in
@objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — …
```

**What an upgrading consumer must do.** Nothing. No key or value changed
status: everything this package accepted before it accepts now, and everything
it refused it still refuses. What changed is which of several competing
complaints an author reads, and that a refusal behind a union is again
reported as `invalid_union` with its branches, which is what `z.treeifyError()`
and this package's own `formatZodError` expand.

⚠️ A closed shape declared with a bare `z.object(…).strict()` or
`z.strictObject(…)` — zod's own, not this package's `strictObject` — does NOT
get this and will still collapse its union. Build closed authoring shapes with
`strictObject`, or re-declare an existing one through `closedObject`.
