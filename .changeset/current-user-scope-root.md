---
"@objectstack/formula": patch
"@objectstack/lint": patch
---

fix(formula,lint): `current_user` becomes a declared root, and its field-level rejection becomes a real rule (#6290)

`@objectstack/formula` told two stories about one root. `introspectScope` handed
`current_user` to authors as a legal namespace and `checkRoleCatalog`'s four
position-membership regexes all lead with it — both correct, because ADR-0068 D1
makes `current_user` THE canonical spelling and `buildScope` really does mount
the same `EvalUser` under it. Only `cel-engine.ts`'s `SCOPE_ROOTS` disagreed, so
the strict environment read the blessed spelling as a BARE FIELD REFERENCE while
its two aliases (`user`, `ctx`) passed unremarked.

Three things change.

**1. `SCOPE_ROOTS` declares `current_user`.** That list is a "never faults"
baseline, not a per-surface contract, and it now advertises exactly what the
package advertises elsewhere. A new pin asserts the property directly: every
root `introspectScope` reports must resolve in the strict env.

**2. The wrong prescription is gone.** Because the rejection used to fall out of
the baseline's omission, the author got the GENERIC bare-field diagnostic —
"Write `record.current_user`". That shape binds on no layer of the platform, so
an author who followed the message ended up with something strictly worse than
what they started with, still silent. The field-level verdict now comes from a
rule of its own in `@objectstack/lint`, which names the real failure (unbound ⇒
fault ⇒ visibility falls back to `true` ⇒ the field a `current_user` test was
meant to hide stays visible for everyone, #6146) and prescribes surfaces that
exist: move the predicate to the option's own `visibleWhen`, declare field-level
security on a permission set (`fields: { '<object>.<field>': { readable: false } }`),
or rewrite it against `record`. It covers `visibleWhen`, `readonlyWhen` and
`requiredWhen`, which share the one evaluator.

**3. Per-option `visibleWhen` is validated at all.** `validate-expressions.ts`
walked field-level conditional rules and stopped there, so `SelectOption.visibleWhen`
— an authorable CEL slot the client filters on AND the server enforces — reached
compile, validate and run time checked by nobody. A bare field reference, a
reference to a field that does not exist, a syntax error or a template-dialect
predicate in an option all shipped in silence, and the option simply never
offered itself. Options are now walked, located by option value, on the same
`record` scope as their host field.

The two surfaces deliberately give opposite verdicts on `current_user`, because
their evaluators differ: field-level rules go through `evalFieldPredicate`
(`record` + `previous` + `parent`, never a user), options through
`resolveCascadingOptions` against the host's predicate scope, which does bind it
(ADR-0068 / objectui#2284). The showcase's role-gated option
(`'admin' in current_user.positions`) had never met this rule before and is now
pinned as the legal usage it is.

Sweep: `objectstack validate` is clean on all three example apps
(`app-showcase`, `app-crm`, `app-todo`) with the option walk active — zero new
findings, including the showcase object that carries both a record-scoped
cascade and the role-gated option.
