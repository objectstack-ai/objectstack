---
"@objectstack/objectql": patch
---

fix(objectql): the per-option `visibleWhen` fail-open log now names which of its two cases it took (#14416)

`evaluateOptionVisibility` admits an option whose `visibleWhen` predicate cannot
be evaluated, and logs it. **That admission is unchanged and deliberate** — a
seed that could not write a gated value would have to walk every row through the
state machine, and a job with no acting user could not write at all. Only the
log changes.

One sentence was describing two different facts. A system write (a declarative
seed, an in-process job — anything with no acting user) can never bind
`current_user`, so every gated option it carries took the fail-open branch and
logged `option visibleWhen for '<f>=<v>' failed to evaluate — allowed through`:
measured at 27 identical lines on one ordinary boot of a seeded app, one per
seeded row, on the correct path. An authenticated caller whose predicate
genuinely faults — a typo'd field, a missing root — produced the **identical**
line, and that one is a gate that is not being enforced. A warning that fires
this often on the expected path stops being read, and takes the real case with
it.

The branch now states which case it is:

- **No acting user, and the predicate asks for one** — reworded to
  `option visibleWhen for '<f>=<v>' not evaluated: no acting user to bind
  current_user (system write) — allowed through`. It deliberately no longer
  contains the phrase `failed to evaluate`, so an operator grepping a boot log
  for that phrase stops matching the expected path.
- **Everything else** — kept loud and now says the gate was not enforced and
  needs checking, with the caller named (`authenticated caller` / `system
  write`).

**Log level is unchanged: both branches stay at `warn`.** The authenticated
fault must not get quieter, and the published sink type
(`EvaluateRulesOptions['logger']`) keeps its shape — it declares `warn` only,
and this change does not widen it. Demoting the no-acting-user case to `debug`
would require adding a `debug` member to that published type and is
deliberately **not** done here.

Both calls now also pass structured `meta` through the sink's already-declared
`(msg, meta?)` second parameter — **additive, no type change**:

- `field` — the field name
- `value` — the picked option value, stringified
- `reason` — `'no-acting-user'` or `'predicate-fault'`, the machine-readable
  form of the distinction above
- `error` — the engine's `EvalError` (`{ kind, message }`), so the underlying
  fault stays recoverable from the line even when the line is the quiet one

The discriminator needs **both** facts — no acting user **and** a predicate that
references the acting user — and reads the second off the parsed CEL AST
(`collectCelRootIdentifiers`, the reader this file already uses for the `parent`
root), never off the fault's message text. Measured: with no acting user,
`'admin' in current_user.positions` reports `Unknown variable: current_user`,
but `'admin' in current_user.positions && record.typo == 1` reports `No such
key: typo` — a message-matching key would file that second predicate as a live
gate failure on every system write. `current_user`'s ADR-0068 aliases (`user`,
`ctx.user`, `os.user`) count as the same root, since `buildScope` mounts one
`EvalUser` under all four and none of them without a user.

No behaviour change: the accept/reject set does not move, a clean `false` is
still refused with `invalid_option`, and an unevaluable predicate is still
allowed through.
