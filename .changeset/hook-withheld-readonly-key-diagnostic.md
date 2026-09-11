---
"@objectstack/objectql": patch
---

fix(objectql): a hook that faults reaching through a withheld read-only key now names the key, says the platform withheld it, and points at `ctx.previous` (#17219)

Since #16344 the update path hides a caller-supplied static `readonly` value from `before*` hooks. A hook body that reaches **through** such a key — `ctx.input.locked_meta.who = 'hook'`, where `locked_meta` is a caller-supplied read-only `json` column — therefore dereferences `undefined` and throws, and a `body` hook's default `onError: abort` refuses the caller's whole write.

**The refusal is correct and is unchanged.** What it replaced is a write that succeeded while persisting a value derived from the caller's forgery, and #16344 exists to close exactly that route. What this fixes is the diagnostic. Measured before this change, at both doors:

```
direct   SandboxError: hook 'guard_task_body' threw:
           TypeError: cannot set property 'who' of undefined
REST     500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
```

The REST reading is the one that matters, and it is the worse of the two: a leading `TypeError:` is correctly classified as a script fault and sanitised (#7543), so an author was told nothing at all — not which key, not that the platform had taken it away, not what to read instead.

### Who is affected

Anyone whose `beforeUpdate` hook reads a read-only field that the caller may also send. The write was already being refused; only the message changes. A hook that needs the stored value reads it from **`ctx.previous.<field>`** — the same remedy PR #17195's changeset documents.

### What the message says now

```
A `beforeUpdate` hook faulted while `locked_meta` was withheld from it. That field is
`readonly: true`, and the engine withholds a caller-supplied value for a read-only field
from `beforeUpdate` hooks, so `ctx.input.locked_meta` reads `undefined` — withheld by the
platform, not missing by accident. Read the stored value from `ctx.previous.locked_meta`
instead. Original fault: TypeError: cannot set property 'who' of undefined
```

The error declares **HTTP 400**, which is what carries it past the script-fault sanitiser onto the same "message verbatim" channel a body's own authored refusal already rides; REST callers who previously saw `500 INTERNAL_ERROR` for this case now see 400 with the text above. The original fault is carried inside the message rather than replaced.

### Deliberate limits

No new error code is registered and no key is added to any published payload — a dedicated `ERROR_CODE_LEDGER` entry for this refusal is a separate decision. The explanation claims only what is knowable at the seam: *faulted while these keys were withheld*, never a proven cause. An **authored** refusal (`throw new Error('…')`) is never rewritten, and a crash on an operation where nothing was withheld passes through untouched.
