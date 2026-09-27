---
"@objectstack/objectql": patch
---

fix(objectql): a chain of `readonlyWhen` locks no longer ignores an edit whose own lock is FALSE on the row the update stores (#19927)

**What happened before.** When `readonlyWhen` locks read each other in a chain,
an update could ignore an edit whose own lock was FALSE on the row it stored.
With `c: { readonlyWhen: "previous.c == 'L'" }`, `x: { readonlyWhen: "record.c
== 'open'" }` and `y: { readonlyWhen: "record.x == 'xv'" }`, `update(r, { c:
'open', x: 'xv', y: 'yv' })` on a row with `c: 'L'` ignored all three fields.
The row keeps `c: 'L'`, so `x`'s lock is FALSE there, yet its edit was lost
with no refusal, and a `strictReadonlyWrites` refusal named `x` as read-only.

**What happens now.** That update stores `x: 'xv'` and ignores `c` and `y`:
`c` is locked, and `y`'s lock reads the `x` the row now holds. This holds by
id and on bulk (`multi: true`) updates, and for `isSystem` callers.

**What else you may see move:**

- `onFieldsDropped` reports only the fields the update ignored (`['c', 'y']`
  above), and a `strictReadonlyWrites` refusal names only those. Whether a
  write is refused under that option does not change.
- An edit that used to be stored can now be ignored. When a field that used
  to be ignored now lands, a lock that reads it can be TRUE on the row the
  update stores, and that lock's field is then ignored instead of written.
  With `p` locked by `previous.p == 'L'`, `m` by `record.p == 'L'`, `j` by
  `record.m == 'new'` and `k` by `record.p == 'L' && record.j == 'new'`,
  `update(r, { p: 'new', m: 'new', j: 'new', k: 'new' })` on a row `{ p: 'L',
  m: 'old', j: 'old', k: 'old' }` used to ignore `j` and store `k: 'new'`; it
  now stores `j: 'new'` and ignores `k`, whose lock reads that `j`. A
  `strictReadonlyWrites` refusal of that update now names `k` instead of `j`.
- A master-detail repoint that such a chain used to hold can now land. With
  `c` locked by `previous.c == 'L'`, the master-detail `invoice` by `record.c ==
  'open'`, `y` by `record.invoice == 'h_open'` and `amt` by `parent.status ==
  'paid'`, an update setting all four on a line with `c: 'L'` under a paid
  invoice used to keep the line there, store `y` and ignore `amt`. It now moves
  the line to `h_open`, stores `amt` (unlocked under the open invoice) and
  ignores `y`, by id and on bulk updates. A `strictReadonlyWrites` refusal of
  that update now names `c` and `y` instead of `c`, `invoice` and `amt`.
