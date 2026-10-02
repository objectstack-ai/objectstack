---
"@objectstack/spec": patch
---

`resolveFieldScale`'s module docblock (`@objectstack/spec/data`) no longer promises a decimal width that a server-side `sum` / `avg` does not deliver

Clause-②: no

- The `number` paragraph said a computed result over a column with no fixed width rounds to the widest decimal count among the values that entered it. That holds only where the renderer sees those values: the grid summary footer, and the `object-metric` tile's `min` / `max`.
- A server-side `sum` / `avg` over a `number` that declares no `scale` does not get that width yet. The tile receives one number, and the analytics result's column metadata (`AnalyticsResultResponseSchema`) carries `format` / `currency` / `percentScale` and no width. The `object-metric` tile shows that answer as a whole number. With no measure `format`, the dataset-bound tile prints an integer as it is and rounds any other value to at most two decimals.
- The docblock now records the ruled end-state: the analytics result reports the width, either the widest decimal count among the values the server read or the field's declared `scale`. It also records the trigger that starts the build: the first first-party `object-metric` tile or dataset measure doing `sum` / `avg` over such a field with no `format`.
- Until then, an author who needs decimals there declares a field `scale` (the `object-metric` tile reads it) or a `format`: the `object-metric` tile's own, or the dataset measure's.
- ⛔ No schema, parse, export, key or runtime change.
