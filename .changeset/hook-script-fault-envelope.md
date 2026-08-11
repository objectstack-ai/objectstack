---
"@objectstack/rest": patch
"@objectstack/example-showcase": patch
---

fix(rest): a crashing hook body answers the sanitised fault envelope, not a raw `TypeError` at 400 (#7543)

`POST /api/v1/data/showcase_task` with `{"title": 12345}` answered

```
400 { "error": "TypeError: not a function", "object": "showcase_task" }
```

— a JS runtime error as the client-facing message, in a body with no `code` at
all. Two contract breaks in one response: an internal fault echoed verbatim to a
caller, and an error body outside the ledgered envelope, so a client keying on
`code` got nothing.

**The seam.** `mapDataError` has two sandbox-unwrap branches, and they are the
only ones in the file that emit `{ error, object }` with no `code` at 400. They
exist for one shape: a hook or action body that runs
`throw new Error('删除被阻断：仍有未结清的发票')` — an author writing a business
rule whose message *is* the remedy, which is answered verbatim at 400 and
deliberately without a `code`. A body that instead **crashes** arrives as a
thrown error too, so it took the same branch and its `TypeError` went out as if
it were that author's message.

**The fix.** Both branches now separate a body that *reported* something from a
body that *faulted*, by the thrown error's constructor name — the sandbox
stringifies a throw as `<name>: <message>`, so a leading `TypeError:`,
`ReferenceError:`, `RangeError:`, `SyntaxError:`, `URIError:`, `EvalError:`,
`InternalError:` or `AggregateError:` is structural evidence of a crash rather
than a keyword heuristic over prose. A crash answers the same sanitised
`500 INTERNAL_ERROR` the mapper's terminal branch already gives — which is not
new policy: that branch's own contract (#5489) names this exact case ("a plain
handler bug (`TypeError: x is not a function`) … server faults that a caller
cannot fix and a caller SHOULD retry"). The unwraps simply sat above it and
intercepted the crash first.

Both doors are guarded, not one. The `innerMessage` branch and the raw-message
regex fallback produce byte-identical bodies, so classifying in only one would
make the envelope depend on whether the `SandboxError` instance survived a
rethrow.

**Unchanged:** a deliberate refusal still reaches the caller verbatim at 400
with no `code`. The fix changes *which* errors take that branch, not what it
emits. A body that expresses a business rule as `throw new RangeError('…')` is
now sanitised — an accepted cost, since that is not the documented authoring
style and the fail-safe direction is the one that does not ship runtime faults to
clients. The operator still gets the full text: 500 is outside
`isExpectedDataStatus`, so `handleRouteError` logs `[REST] Unhandled error` with
the whole error.

**Showcase.** `NormalizeTaskTitleHook` guarded its trim with truthiness
(`if (ctx.input.title)`), so the number `12345` passed the guard and had no
`.trim`. It now checks `typeof … === 'string'`. That is the actual cause of the
reported repro, and with it fixed the request **succeeds** rather than erroring:
`record-validator` coerces a `text` value with `String(value)`, so a number in a
text field breaks no declared contract. These hook bodies are read as
documentation, so the type-safe shape is the one to show — a hook must not assume
a field's runtime type just because its metadata declares one.
