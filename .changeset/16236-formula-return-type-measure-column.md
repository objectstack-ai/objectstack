---
"@objectstack/service-analytics": minor
---

fix(service-analytics): a `min`/`max` over a `formula` field is typed from the formula's declared `returnType`, not described as `number` (#16236)

> ⚠️ **Superseded within the same release window — ⛔ do not act on this entry.**
> Everything below was accurate when it was written and is kept as the record of what
> #16236 measured and built. It never reached a published version: **#17560** (director
> ruling, decision batch #127, 2026-09-13) refuses `min` / `max` over a `formula` field
> outright, on the compatibility table's own storage ground — a formula is VIRTUAL in SQL
> storage, no column is emitted, so no aggregate can be lowered to it whatever
> `returnType` says. At the version that compiles this entry such a measure answers
> `DATASET_INVALID` / **400** at compile time instead of carrying any `fields[].type`, and
> the `returnType?: string` member described at the foot of this entry is **not** on
> `AnalyticsServiceConfig.sourceFieldMeta` — it was added and removed inside one release
> window, so no published version ever carried it. ⇒ Read #17560's entry instead; the
> FROM → TO below never became a shipped behaviour.

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

⚠️ **Superseded — see the banner at the top.** #17560 removed that member again in
the same release window, so the shape a host writes against is the three-member one
this paragraph calls today's. Nothing to do either way: a host that returns the
fourth key is ignored, not refused.
