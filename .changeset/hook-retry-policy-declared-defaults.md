---
"@objectstack/objectql": patch
---

fix(objectql): a hook's `retryPolicy` gets the same defaults whether or not its metadata was parsed (#6832)

`HookSchema` declares `retryPolicy.maxRetries` with `.default(3)` and
`retryPolicy.backoffMs` with `.default(1000)`. The executor that actually
performs the retries read both with `?? 0`. So "how many times does an
under-specified hook retry?" had **two answers**, and which one you got depended
on whether the metadata had been through `HookSchema`:

- parsed — `defineStack({ hooks })`, `PUT /meta`, the Studio form — got **3
  retries with a 1000ms backoff**, matching the schema, the generated reference
  page and the Studio form;
- unparsed — the public `wrapDeclarativeHook` export, and `bindHooksToEngine`'s
  own call, which hands it `Hook` metadata verbatim — got **0 and 0**.

The failure was silent and pointed the wrong way: a retry surface that does not
retry raises no error, logs nothing, and fails no test. It just loses the
recovery the author believed they had configured. This is the divergence #4247
removed from flow `errorHandling` ("one contract, one number"), one surface over
and with the numbers swapped, and the `declared = enforced` case ADR-0049 exists
to close.

`wrapDeclarativeHook` now reads both defaults **out of `HookSchema`** instead of
restating them, so the two paths agree by construction and a future key added to
`hook.retryPolicy` needs no matching edit in the executor.

**The boundary, which is deliberately unchanged — read this if you own hooks.**
`retryPolicy` is `.optional()` with no `.default({})`, so an absent block and an
empty one are different declarations, and they stay different:

- **`retryPolicy` omitted entirely → still zero retries.** No policy was
  declared, so none is applied. This is the behaviour every existing hook has
  today and it does not change. (Making the omitted case default to 3 would have
  "fixed" the divergence by silently giving every hook in every existing app
  three retries it never asked for — a larger behaviour change than the defect.)
- **`retryPolicy: {}` or a half-filled block → the declared defaults now apply.**
  `retryPolicy: {}` means 3 retries / 1000ms; `retryPolicy: { backoffMs: 500 }`
  means 3 retries / 500ms. Previously both of these retried zero times on the
  unparsed path. If you wrote an empty or partial `retryPolicy` against a host
  that does not parse its hook metadata, that hook now retries as its schema,
  docs and Studio form have always said it would.

Any value you wrote explicitly still wins outright, including an explicit
`maxRetries: 0`. The backoff remains linear (`backoffMs * attempt`), which is
what the declared shape describes.
