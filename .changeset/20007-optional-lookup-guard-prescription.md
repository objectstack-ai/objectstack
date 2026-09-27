---
'@objectstack/formula': patch
'@objectstack/objectql': patch
---

fix(formula,objectql): the two refusals a traversing validation rule on an optional lookup meets now name the repairs that work — a `conditional` wrapper or `required: true` (#20007)

Clause-②: no

An author who wants to refuse a write when an OPTIONAL lookup is set and its related record is secret writes `record.line != null && record.line.kind == 'secret'`. Two refusals then sent them in a circle:

1. That expression reads `line` both through the relationship and as a plain value, which cannot be served, and is refused. The refusal said to "compare the id explicitly" and write `record.line.id` for the value comparison.
2. `record.line.id != null && record.line.kind == 'secret'` reads through `line` too, so an order with no line is refused before the rule is evaluated, as "no single related record". That refusal said to "guard the rule on the reference being set" and named no spelling for the guard.

Which writes are refused is unchanged, and so are the error, the `rule_violation` field error and its `constraint` (`reason: 'unevaluable'` and the fault). `@objectstack/lint` passes the formula refusal through unchanged, so it shows the new text too. Only the prescriptions change. Both now name the two spellings measured to work for an optional reference, and the guard is worded exactly as in the delete-cleanup refusal:

```text
… To compare the id, write `record.line.id` for the value comparison, and keep
`record.line.<related field>` for the traversal. `record.line.id` is not a null guard: it
reads through `line` too, and a rule that reads through an empty `line` rejects the write
instead of being skipped. If the plain value tests for empty, take that test out of this
expression. To skip the rule while `line` is empty, guard it on `line` being set: make it
the `then` of a `conditional` rule whose `when` is `record.line != null`. To refuse an
empty `line`, make `line` required (`required: true`).
```

```text
… A predicate resolves ONE hop through a single reference. To skip the rule while `line`
is empty, guard it on `line` being set: make it the `then` of a `conditional` rule whose
`when` is `record.line != null` — `record.line.id != null` inside the rule is no guard, as
it reads through `line` too. To refuse an empty `line`, make `line` required
(`required: true`). For a multi-value reference, test it with a macro (`exists`, `size`)
instead of reading through it.
```

The repair as an author writes it, measured end to end on insert and update. It accepts an order with no line or a public line, and refuses a secret line with the rule's own message:

```ts
validations: [{
  name: 'no_secret_line_when_set', type: 'conditional',
  message: 'Only checked while the order names a line.',
  when: 'record.line != null',
  then: { name: 'no_secret_line', type: 'script', message: 'An order may not carry a secret line.',
          condition: "record.line.kind == 'secret'" },
}]
```

With `required: true` on `line` instead, an order with no line is refused at the field (`required`), and the rule still judges one with a line.
