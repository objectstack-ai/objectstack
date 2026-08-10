---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec,service-automation): a flow variable can declare a `defaultValue`, so "declared" means "bound" (#4697)

Declaring a flow variable used to guarantee nothing at run time. The engine bound
an `isInput` variable **only** when the caller actually supplied it
(`params[name] !== undefined`), so every path that omitted the parameter left the
name unbound — and a flow condition is strict CEL, where an unbound name does not
read as `false`, it **aborts the predicate and stops the run**. The declaration was
documentation, not a guarantee, and there was no metadata form that said "this
variable always has a value".

`FlowVariableSchema` now takes an optional `defaultValue`, and the engine binds it
whenever no parameter supplies one:

```typescript
variables: [
  { name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false },
]
```

The rules:

- **A supplied parameter always wins**, including a falsy one — the boundary is
  `!== undefined`, so `false`, `null`, `0` and `''` are answers rather than
  absences, and only a genuinely missing parameter falls through to the default.
- **A non-input declaration takes its default too.** `isInput: false` means no
  parameter can reach the name, so the default is the only thing that can bind it.
- **A declared variable shadows a trigger-record field of the same name**, whether
  it was bound from a parameter or from its default — the rule a parameter already
  followed. A name cannot resolve out of a different source depending on whether
  the caller passed it.

Both run entry points seed from one shared site, so the retry path behaves
identically to the first attempt.

**Additive and opt-in.** A declaration without `defaultValue` behaves exactly as
before, so existing flows parse and run unchanged. The value is not cross-checked
against the declared `type` — `type` is an open string with no vocabulary to check
against, the same posture as every other `defaultValue` on the authoring surface.

The case this closes came from a screen flow (hotcrm#643): a screen collects an
optional checkbox, the client returns only the fields the user actually touched,
so on the untouched path the variable was never bound, the outgoing edge aborted,
and a lead conversion persisted nothing. The workaround was an `assignment` node
before every screen mirroring the screen field's own `defaultValue`; a declared
default replaces that ceremony.

The docs half of the same gap is now written down too
(`content/docs/automation/flows.mdx`): under strict CEL the guard an author
reaches for first — `has(X.f)` — **aborts** on an unbound `X`, the very case it is
written for. Only the `vars.`-scoped `has(vars.X)` tests bindedness. That truth
table is measured against the live evaluator in
`service-automation/src/flow-variable-default.test.ts` rather than asserted, so a
prescription nothing executes cannot quietly stop being true. Prefer
`defaultValue` over either guard: a guard encodes "unanswered means no" into the
predicate and leaves the graph defect in place.
