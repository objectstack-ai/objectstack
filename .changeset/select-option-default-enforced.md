---
"@objectstack/objectql": minor
---

feat(objectql): the option marked `default: true` is now the field's default on insert (#7246)

`SelectOption.default` has been authorable and spec-valid since the schema was
written, and nothing on the insert path read it. `ObjectQL.applyFieldDefaults`
resolved `f.defaultValue` — Expression envelopes, the `DEFAULT_VALUE_TOKENS`
family, then static literals — and never looked at `options`. So this, which
reads like a declaration of the initial value:

```ts
status: Field.select({
  label: 'Status',
  options: [
    { label: 'Draft', value: 'draft', default: true },
    { label: 'Approved', value: 'approved' },
  ],
}),
```

stored **null** on a create that omitted the field, not `draft`.

The key's one consumer anywhere in the repo was lint's `isNullableField`, which
concluded from it that the column was **always valued** — and that verdict is
build-breaking. So the single place that read the key trusted it, while the
place that would have made it true ignored it: a predicate over such a field
could be silenced by a heuristic resting on a declaration nothing honoured.

**After** (maintainer ruling on #7246, ADR-0049 enforce leg): a field that
declares no `defaultValue` falls back to the option marked `default: true`, on
every driver, resolved by the engine exactly as the token family is.

- **`defaultValue` wins when both are declared** — the more specific
  declaration. It names a value for *this* field; the option flag describes the
  shared option list. When the two disagree the flag stays inert, as it was
  everywhere before.
- **Presence is the engine's own `dv == null` test.** `defaultValue: ''` is a
  real default and still wins; the fallback fires only when `defaultValue` is
  absent by that test.
- **The fallback resolves in the `defaultValue == null` arm**, downstream of the
  token and envelope branches, so an option value is always a plain literal — an
  option spelled `current_user` stores those twelve characters rather than the
  acting user's id.
- **`multiple: true` assembles an array** of every marked option in declaration
  order, because that field stores an Array/JSON; a single-valued field with
  several marked options takes the first.
- **No physical column DEFAULT** is emitted for an option-default. The engine is
  the one place the two spellings are ranked, the multi-select shape has no
  scalar DDL form, and emitting would give new databases a default that older
  ones on identical metadata lack with nothing to report the divergence. The
  reasoning is recorded on `SqlDriver.applyDeclaredColumnDefault` and pinned by
  test.

**Migration.** Metadata declaring an option `default: true` on a field with no
`defaultValue` changes insert behaviour: records that used to be born with a
null in that column are now born with the marked option. That is the behaviour
the declaration always described. In the shipped corpus this covers 30 fields
across the showcase, CRM and todo example apps and the downstream-contract QA
fixture — all of them status/stage/priority selects whose marked option is the
intended initial state. To keep the previous behaviour, drop the `default: true`
flag from the option; to make the value explicit, declare `defaultValue`
alongside it, which now outranks the flag.
