---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): keep the logger's receiver when selecting a log channel — class-based host loggers no longer crash, so audience refusals report their verdict instead of `500 null` (#12773)

Three sites picked a log channel by **extracting** the method before calling it:

- `auth-manager.ts` — `(logger?.error ?? logger?.warn)?.(message, meta)` in `audienceLogError`
- `reconcile-membership.ts` — `const log = deps.logger?.error ?? deps.logger?.warn` in `refuseInvalidPolicy`
- `adopt-membership.ts` — `const log = options.logger?.info ?? …` in `adoptExistingMembership`

`a.b` in *call position* passes `a` as the receiver; `(a.b ?? c.d)(…)` evaluates to
the bare function first, so the call runs with `this === undefined`. A plain-closure
logger does not read `this` and survives it. `@objectstack/core`'s `ObjectLogger` is a
real class with prototype methods and no constructor binding — `error`/`fatal` reach for
`this.writeErrorLike`, `debug`/`info`/`warn` for `this.write` — so it threw:

```
TypeError: Cannot read properties of undefined (reading 'writeErrorLike')
    at error (.../packages/core/dist/index.js:650:10)
    at _AuthManager.audienceLogError (.../plugin-auth/dist/index.mjs:5460:38)
```

In `validateAudienceAdmission` the damage compounded: the throw from the `try` landed in
the `catch`, which called the same helper again, so the second throw escaped the gate.
An audience refusal — a decided, fail-closed 4xx naming exactly what the operator had
misconfigured — was delivered to the client as **`HTTP 500` with a null body**, and the
verdict reached neither the caller nor the log.

Each site now calls through the **property** while keeping its fallback, so both halves
of the contract hold: the `error` → `warn` degradation (#9754) and the receiver.

No behaviour changes for a host whose logger is a plain closure object — that shape
worked before and is pinned unchanged. The gate's decisions, codes and messages are
untouched; only their *delivery* is repaired.

The regression pin (`logger-receiver-detach.test.ts`) uses a **class-based** logger
double whose methods dispatch through `this`, because a closure double passes against
the broken code and pins nothing; its case ⓪ asserts that receiver-sensitivity directly
so the file cannot quietly become vacuous.
