---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec,automation): `update_record` / `delete_record` can declare bulk intent with `multi` (#5393)

A flow could not express "write every row this filter matches" — at all, from
any app. `UpdateRecordConfigSchema` / `DeleteRecordConfigSchema` are
`strictObject`s and neither declared any spelling of bulk intent (`multi`,
`bulk`, `all` and `options.multi` were each rejected as an unrecognized key),
and the CRUD executors never passed `options.multi` to the data engine. The
engine accepts a write only when `where.id` is a **scalar** or `options.multi`
is truthy, and throws otherwise — so a predicate `update_record` /
`delete_record` was unreachable, while the node descriptors advertised
`Delete Records` / "Delete records matching a filter." Declared ≠ enforced
(Prime Directive #10); the symptom was #5225's showcase sweep flow, which had
never deleted a record.

**New authorable key — `multi` (boolean, default `false`), on `update_record`
and `delete_record`.** One name for one concept (PD #12): `multi` is what the
data engine has always called it (`EngineUpdateOptions.multi` /
`EngineDeleteOptions.multi`), so the word is the same from node config to
driver call and greps end to end.

```ts
// before — refused by the engine at run time, with no authoring-time signal
{ type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' } } }

// after — the declaration makes the intent explicit and the write reachable
{ type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' }, multi: true } }
```

- **Absent or `false`** — unchanged behaviour. The executor forwards
  `multi: false`, so the write must name one row by scalar `id`; anything else
  (a predicate, or `id: { $in: [...] }`) is refused by the engine with
  `Delete requires an ID or options.multi=true`. **That refusal is the
  contract**, not a defect to route around: it is what keeps an undeclared
  unbounded write from happening by accident.
- **`true`** — the executor forwards `options.multi: true`, the write lands on
  `driver.updateMany` / `deleteMany`, and the step's `acted` metric reports the
  affected row count.

Additive and backward compatible: no existing flow changes behaviour, and every
by-id write keeps working untouched.

Two guards are unchanged and worth stating explicitly. The #3810
erased-condition guard still refuses a node whose authored filter condition
interpolated to nothing, `multi` or not — bulk intent says "many rows are
fine", never "a condition may vanish". And `multi: true` with **no** `filter`
is the whole object, by declaration: write the constraint you mean.

Wrong spellings are answered by name rather than by edit distance (which
reaches `multi` from none of them): `bulk` / `all` / `multiple` get the
prescription, and `options: { multi: true }` is called out as the engine's
options bag written at the node's altitude.
