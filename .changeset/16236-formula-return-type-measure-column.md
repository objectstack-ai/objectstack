---
"@objectstack/service-analytics": minor
---

fix(service-analytics): a `min`/`max` over a `formula` field is typed from the formula's declared `returnType`, not described as `number` (#16236)

**Behaviour change — read this if any dataset measure aggregates a `formula`
field.** `AnalyticsResult.fields[].type` for such a measure column was always
`number`, whatever the formula computes. It is now translated from the field's
declared `FieldSchema.returnType`:

```
FROM  {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
       "fields":[{"name":"first_label","type":"number"},
                 {"name":"latest_due","type":"number"}]}

TO    {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
       "fields":[{"name":"first_label","type":"string"},
                 {"name":"latest_due","type":"time"}]}
```

Both values were strings; both descriptors said `number`, so a renderer that
branches on the declared type never reached its textual or temporal branch.

**The mapping is a TRANSLATION, not a pass-through.** `returnType` speaks the
authoring vocabulary (`number` / `text` / `boolean` / `date`);
`fields[].type` speaks `DimensionType` (`string` / `number` / `boolean` /
`time` / `geo`). Two of the four words do not exist on the wire at all:

| declared `returnType` | `fields[].type` |
|:---|:---|
| `text` | `string` |
| `date` | `time` |
| `number` | unchanged — the producer's `number` is already correct |
| `boolean` | unchanged — three readings disagree on what `min`/`max` over a boolean returns |

**A formula with no `returnType` is unchanged.** The key is optional — "absent
when the type can't be proven (an ambiguous/`dyn` expression)" — and an
unproven formula's measure column keeps the `number` it had. The absence is not
read as an answer. That tier is written down as a row in `measureResultType`'s
own table rather than left as an implied code path, and so is the treatment of
a word outside the declared four: left alone, never guessed at.

**For hosts wiring `AnalyticsService` directly.** `AnalyticsServiceConfig`'s
`sourceFieldMeta` hook gains an optional fourth member on its return —
`returnType?: string` beside `type` / `defaultCurrency` / `max`. Additive: a
host that returns the three-member shape still satisfies the contract and gets
exactly today's behaviour for every column. `AnalyticsServicePlugin` relays the
key automatically, so a host on the plugin needs no change at all.
