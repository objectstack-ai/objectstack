---
'@objectstack/service-analytics': patch
---

fix(analytics): an `undefined` comparand in an analytics `where` is refused (400 `INVALID_FILTER`), not read seven different ways

**Observable behaviour change.** A `where` key whose value is `undefined` used to
compile — in seven different ways, depending on where it sat. It is now refused
with `INVALID_FILTER` / 400, the envelope every other refusal at this door
already carries.

The three that mattered WIDENED the query, which is the failure mode
`filter-normalizer.ts` forbids in its own body ("NEVER drop: a missing predicate
does not narrow the query, it WIDENS it"), while its entry line did exactly that:

| `where` | used to normalize to | reading |
|---|---|---|
| `{d: undefined}` | `null` | the WHOLE filter dropped — the query ran **unfiltered** |
| `{stage: 'won', d: undefined}` | `stage equals 'won'` | the `d` conjunct vanished in silence |
| `{$not: {d: undefined}}` | `NOT (d set)` | `d IS NULL` — a predicate the author never wrote |
| `{d: {$eq: undefined}}` | `d equals [null]` | a value comparison, **not** `$eq: null`'s null predicate |
| `{d: {$gt: undefined}}` | `d gt [null]` | ditto |
| `{d: {$in: [undefined]}}` | `d in [null]` | ditto |
| `{d: {$ne: undefined}}` | `d notSet OR d notEquals [null]` | ditto |

The direction is silently **wrong results** — an analytics figure, a report
total, an aggregate, wrong with nothing to read — **not** a permission bypass:
read scope is compiled by a different door (`read-scope-sql.ts`) and never passed
through here, so a caller still saw only rows it was entitled to, just more of
them than it asked for.

**What to change if this refuses your filter.** `undefined` cannot cross JSON, so
neither REST door can carry it — this only reaches in-process callers of
`AnalyticsService.query({ where })` that spread a possibly-absent value into the
filter object (`{ owner_id: ctx.user?.id }`). Two repairs, both stated by the
error message:

- meant the null predicate → write `{ field: null }` or `{ field: { $null: true } }`;
- the value is genuinely absent → **omit the key**, which is the same "no
  constraint" without the ambiguity.

Inside stored metadata, the platform's own answer to "scope this to the current
user" is unaffected and was already fail-closed: a `{current_user_id}`
placeholder resolves through `resolveFilterTokens`, which raises
`FILTER_TOKEN_UNRESOLVED` / 400 rather than emitting `undefined`.

⛔ **`null` does not move.** `{d: null}`, `{$eq: null}`, `{$ne: null}`,
`{$null: …}`, `{$exists: …}` and `$contains: null` keep their exact lowering —
`null` is a declared comparand and is the null predicate. `$null` / `$exists`
carry a declared boolean flag rather than a comparand and are likewise untouched.
