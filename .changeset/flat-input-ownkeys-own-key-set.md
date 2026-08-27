---
'@objectstack/objectql': patch
---

fix(objectql): the flat-input proxy's `ownKeys` reports the payload's own key set, not its enumerable subset (#12578)

`installFlatInput` answered the `ownKeys` trap from `Object.keys(data)` — own **enumerable
string** keys. That filtering was incidental to what the trap is for (hiding the wrapper keys
`id`/`options`/`ast`/`data` from `Object.keys`/`for…in`), and it cost a key: an own
**non-enumerable** key on the record payload was absent from `Object.getOwnPropertyNames(input)`
and `Reflect.ownKeys(input)` while `hasOwnProperty` and the descriptor trap both reported it —
and while the engine persisted the row holding it. Measured on the merged ref, for a payload
`{ subject }` a handler had added `k` to with
`Object.defineProperty(ctx.input, 'k', { value: 1, enumerable: false, configurable: true })`:

```
Object.getOwnPropertyDescriptor(input, 'k')       -> own, enumerable:false
Object.prototype.hasOwnProperty.call(input, 'k')  -> true
Object.getOwnPropertyNames(input)                 -> ['subject']       <- not own?
Object.getOwnPropertyNames(persisted row)         -> ['subject', 'k']
```

Three instruments, one payload, two answers about own-ness. Newly reachable rather than newly
written: #12277 routed `defineProperty` into the payload, so a handler can put a
non-default-attribute key there for the first time, and #12397 made the descriptor trap mirror
the payload instead of synthesising defaults — which is what gave the third instrument an
opinion to disagree with.

The trap now reports `Object.getOwnPropertyNames(data)`. **The enumerable face is unchanged**:
`Object.keys`, spread, `Object.entries`, `for…in` and `JSON.stringify` still omit a
non-enumerable key, because each applies the `enumerable` filter itself, one layer up, through
the descriptor trap. Applying it inside `[[OwnPropertyKeys]]` as well did not make those answers
cleaner — it only starved the two surfaces whose entire job is to report the whole set. The
sandbox body face is byte-identical for the same reason: `unwrapProxyToPlain`
(`@objectstack/runtime`) snapshots `ctx.input` as `Object.entries` over this proxy.

Wrapper keys stay excluded, which is the trap's purpose — achieved by reading `data` and never
the wrapper, not by subtracting those four names, which would hide a genuine payload field named
`id`. **Symbol keys remain unenumerated**: they already reach the payload and already persist, so
publishing them through `ownKeys` is a question about what a record payload may hold rather than
about this trap, and it is left open on #12578 rather than decided here.

Pinned in `hook-input-ownkeys-agreement.test.ts` as the AGREEMENT of the three own-ness
instruments — not as one trap's output, which is the pin shape that let the halves diverge — with
the wrapper-key and symbol exceptions pinned as deliberate exceptions. Reverse-verified by
ablation: restoring `Object.keys(target.data)` fails exactly 2 of the 6 new cases (32 of 34 green
across the four hook-input suites), and the enumerable-face assertions stay green under the
mutation, which is what proves that half untouched.
