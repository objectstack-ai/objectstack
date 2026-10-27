---
'@objectstack/spec': minor
---

fix(spec)!: every filter door refuses a `{ $now, addDays }` anchor that carries any other key, as `NowAnchorSchema` already declares, instead of running it on the `addDays` reading alone

`NowAnchorSchema` is closed: `{ $now: true, addDays: -30, subDays: 7 }` fails to parse on its own. But the comparand-type walk every filter door runs (`normalizeFilterComparandTypes`, through `FilterConditionSchema` and `parseFilterAST`) judged an anchor by its `addDays` alone, so the extra key was kept, every executor ignored it, and the query answered the `addDays` reading with no word. The walk now refuses an anchor with any key other than `$now` and `addDays`, with the existing `INVALID_FILTER` / 400 envelope, and the refusal names the key: `it carries an undeclared key "subDays" — the anchor takes $now and addDays only (there is no subDays: a negative addDays subtracts)`.

Clause-②: no (narrowing) — every filter door refuses a `$now` anchor carrying a key beyond `$now` / `addDays`, which it ran before. Nothing is widened.

Metadata-protocol: narrowed (a filter saved through `FilterConditionSchema` may no longer carry a key beside `$now` and `addDays` on a now-anchored comparand)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: NowAnchorSchema declared exactly $now and addDays since it shipped, and this aligns the walk with that declaration. An extra key never had a meaning at any executor, so there is no rewrite that keeps what the author meant; the author decides, and the refusal names the key. -->

**BREAKING** accept-set narrowing at the filter comparand-type walk (`@objectstack/spec`), served at every filter door.

- **Before.** `engine.find()` / `count()` / `update()` in object or array form, `aggregate()`'s `where`, `aggregations[i].filter`, `having`, and a filter saved through `FilterConditionSchema` all kept `{ $now: true, addDays: N, subDays: M }` or `{ …, note: 'x' }`. The query ran on `addDays` alone.
- **Now.** Each of them answers `INVALID_FILTER` / 400 (a save fails its parse), naming the undeclared key.
- **Unchanged.** A well-formed anchor, `{ $now: true, addDays: <integer | { $field }> }`, and its resolved form (`$now` holding the pinned ISO instant) run as before at every door. The refusals for a missing or malformed `addDays` keep their wording.
- **Who sees it.** An author who wrote an extra key on an anchor. That key was ignored before, so the rows answered were the `addDays` rows.

**The remedy.** Drop the extra key. To move the instant back, give `addDays` a negative value; to read the offset off a column, use `addDays: { $field: 'numeric_column' }`.
