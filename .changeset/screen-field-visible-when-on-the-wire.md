---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

fix(automation): a screen field's `visibleWhen` reaches the client (#3528)

`visibleWhen` has been on the `screen` node's designer form since #3304 —
declared as an expression (`xExpression`), documented as bare CEL, offered to
authors in Studio. The executor never put it on the wire. `ScreenFieldSpec`
carried `name` / `label` / `type` / `required` / `options` / `defaultValue` /
`placeholder` and nothing else, so no client could honour a predicate it never
received. Authors wrote conditional visibility; every field rendered
unconditionally; nothing errored.

That is worse than a cosmetic miss, because `required` **is** honoured. A field
that is optional-by-design but required *when shown* becomes permanently
required once its predicate is dropped — and a runner that validates the full
field list then blocks Submit on input the user was never asked for. No resume
request is issued and the run sits paused forever. HotCRM's lead-conversion
screen is exactly that shape:

```ts
{ name: 'createOpportunity', type: 'boolean', required: true },
{ name: 'opportunityName',   type: 'text', required: true,
  visibleWhen: 'createOpportunity == true' },
```

Leave the checkbox unticked and `opportunityName` — which should not be on
screen at all — blocks the whole conversion.

- `ScreenFieldSpec.visibleWhen` is now part of the contract, documented as
  client-evaluated bare CEL over the screen's own field names, with the
  `required`-must-follow-visibility rule stated where implementors will read it.
- The `screen` executor forwards it **raw**, deliberately uninterpolated: the
  predicate is re-evaluated per keystroke against values only the client has, so
  resolving it server-side against flow variables would freeze the field.
- Covered by tests — the screen wire payload had none for this key.

Clients must evaluate the predicate and skip hidden fields when enforcing
`required`. Honouring one without the other reproduces the dead-end above.
