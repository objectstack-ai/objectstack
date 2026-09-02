---
"@objectstack/cli": patch
---

fix(cli): stop lowering hook/action bodies that reference globals the sandbox does not provide (#14301)

`detect-free-identifiers`' ambient allowlist was ONE generous list, documented as
"assume the runtime has it". The runtime a lowered body actually runs in is the
QuickJS sandbox, not the Node process that runs `objectstack build` — and the
list named `Intl` beside `JSON`, under the comment "Web-ish that the sandbox /
Node commonly provide". So a handler calling `Intl.DateTimeFormat` had no free
identifier at all: `extractHookBody` lowered it into `body.source`, the #13651
lint rule had nothing to report (it fires only on a *refused* lowering),
`validate` / `typecheck` / `test` / `build` were all green because the
in-process test runs the RAW function in Node where `Intl` exists — and
production threw `ReferenceError: Intl is not defined`. Under the
`onError: 'abort'` a validation-shaped hook must declare, that refuses every
write to the object.

The allowlist is now two sets, and membership is **measured**, never recalled: a
`typeof X`/`'X' in globalThis` probe is evaluated inside the same
`QuickJSScriptRunner` the runtime evaluates a body in, and
`sandbox-globals-probe.test.ts` fails unless each set is exactly the probe's
present/absent partition.

- **`SANDBOX_GLOBALS` (53, measured present)** — the ECMAScript surface:
  `Math` `JSON` `Date` `Object` `Array` `String` `Number` `Boolean` `RegExp`
  `Map` `Set` `WeakMap` `WeakSet` `Promise` `Symbol` `BigInt` `Function`
  `Reflect` `Proxy`, the typed-array/buffer family, the eight error
  constructors, `parseInt` `parseFloat` `isNaN` `isFinite` and the four URI
  functions, plus `undefined` `NaN` `Infinity` `globalThis`.
- **`NODE_ONLY_GLOBALS` (15, measured absent)** — `Intl`, `structuredClone`,
  `queueMicrotask`, `atob`, `btoa`, `setTimeout`, `clearTimeout`,
  `setInterval`, `clearInterval`, `URL`, `URLSearchParams`, `TextEncoder`,
  `TextDecoder`, `console`, `arguments`.

A free reference to one of the 15 is now a lowering refusal whose reason names
the identifier and the remedy — a string handler ref (`functions:` map plus
`handler: 'fn_name'`) or a validation rule, and for `console` specifically the
capability-gated `ctx.log`. It travels the SAME path #1876 already used: the
refusal is `kind: 'free-identifiers'` with the host-only half carried
separately as `nodeOnlyIdentifiers`, `lowerCallables` catches it and ships the
callable through the `.mjs` bundle (where it runs in-process in Node and
works), `os build` still exits 0 with a warning, and `os lint` reports it under
`hook-body/not-lowerable` as an `error` — the ACCIDENTAL class, because `Intl`
is a standard global in every browser and in Node and writing it is not the
recognisable "I am reaching for the host" act that `fetch(` and `process.` are.
The remedy sentence `os lint` prints is chosen from the refusal's own
classification: "inline the value" is impossible for a host global, and
printing it anyway would send an author after a second broken shape.

⛔ Not changed here: whether `os build` fails on the lowering class (#13838),
and what the sandbox provides (giving it `Intl` would be a capability
expansion). Nothing under `packages/runtime/**` is touched — the probe reads
that sandbox, it does not change it.

**Why `patch`.** No published accept-set moves: the metadata a valid app may
declare is identical, `HookBodySchema` is untouched, and no key is added,
removed or re-shaped. What narrows is which handlers the build LOWERS, and for
every handler affected the previous outcome was a body that could not run. An
app hitting this gains a warning and a working bundled closure in place of a
production `ReferenceError`; the deployment shape it loses was never one it had
in working order. Measured corpus: zero in-repo example or template handlers
reference any of the 15.
