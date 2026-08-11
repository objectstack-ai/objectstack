---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

fix(objectql,runtime): stop the platform's own stamps from failing spec validation — `/meta/diagnostics` reads clean again (#7561)

`GET /api/v1/meta/diagnostics` reported **94 of 94** registry entries INVALID —
every entry, `sys_*` and `showcase_*` alike. The endpoint reports entries that
fail their registered Zod schema, so at a 94/94 baseline it carried **no
signal**: a genuinely broken object was indistinguishable from a healthy one,
and any gate or dashboard built on it read permanently red.

Both error shapes behind the 94 were self-inflicted — the platform reporting
defects about columns it wrote itself, on documents no author wrote or could
fix.

**`fields.__search: Unrecognized key 'index'`.** `provisionSearchCompanion`
stamped `index: true` on the hidden `__search` companion column. Field-level
`index` was removed from `FieldSchema` in the 16.x line (#2377, ADR-0049)
because a field-level index flag built no index, and `FieldSchema` is a
`strictObject`, so the key was rejected by name. The companion is provisioned
before the document is stored and `/meta` re-parses the served body, so the
stamp badged `_diagnostics: { valid: false }` onto every object the platform
provisions a companion for. This is the #6810 mechanism one field over
(`applySystemFields` stamping `indexed` on `organization_id`), and the same
retired key. The stamp is gone, along with the docblock claim that the column
"IS `index`ed".

Unlike #6810 the index is **not** re-declared in the object's `indexes[]`, and
that difference is measured rather than overlooked. #6810's predicate is
`organization_id = ?` — equality, which a B-tree serves. This column's only
reader is `buildSearchFilter`, which emits `{ __search: { $contains: term } }`
— a leading-wildcard `LIKE '%term%'` no B-tree can answer — and `IndexSchema`
spells nothing else (`name` / `fields` / `unique`; no trigram/GIN method).
Declaring one would buy write amplification on every row for a read path that
cannot use it. Search behaviour is unchanged either way: nothing read the flag.

**`config: expected record, received undefined`.** The datasource-visibility
registration in `DefaultDatasourcePlugin` published the `default` row without
`config`, which `DatasourceSchema` requires. It is now stamped `{}` —
deliberately empty, not the host's real config, which carries connection
credentials that would otherwise land on `GET /api/v1/meta/datasources` for
every metadata reader. No information is lost versus the omitted key; only the
spelling changes to the one the contract accepts. Fixed at the producer rather
than by widening the spec: a real datasource document genuinely needs its
config, so relaxing the schema would trade one honest verdict for a permanently
weaker one.

**So it stops recurring.** Two pins land with the fix, because patching one key
at a time is what turned #6810 into this card. A class pin walks every field
the platform stamps — `applySystemFields` and `provisionSearchCompanion`,
across every ownership / tenancy / `systemFields` branch — through
`FieldSchema`, so the next retired-key stamp turns a suite red instead of
poisoning diagnostics. A baseline pin asserts a realistically-built registry
sweeps clean, naming both of this card's error shapes explicitly; the 94/94
state survived undetected until a human read the endpoint by hand, because
nothing asserted the baseline.
