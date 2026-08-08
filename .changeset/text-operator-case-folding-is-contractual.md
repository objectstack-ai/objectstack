---
"@objectstack/driver-sql": minor
"@objectstack/driver-sqlite-wasm": minor
"@objectstack/driver-turso": minor
---

fix(drivers): text-operator case folding is the CONTRACT's answer, not the dialect's (#6518)

The `$contains` family and `$icontains` returned **different rows on different
databases** for the same filter, because case sensitivity was decided by whatever
`LIKE` happened to mean on the dialect underneath. Both directions **over-matched**
— they returned rows the filter excludes, which on an ADR-0021 RLS read scope is
over-reach rather than a loose filter (#3948):

| | `$contains` / `$notContains` / `$startsWith` / `$endsWith` — case-SENSITIVE (#4706 Q2 = A) | `$icontains` — folds ASCII ONLY (#4706 Q1 = A) |
|:--|:--|:--|
| SQLite / turso / sqlite-wasm | ❌ `LIKE` folds ASCII | ✅ `lower()` is ASCII-only |
| Postgres | ✅ `LIKE` is case-exact | ❌ `LOWER()` folds all of Unicode |
| MySQL | ❌ follows the column's collation | ❌ `LOWER()` folds all of Unicode |

Read across: **each dialect was already right on the half another one got wrong**,
which is why neither half could be found from one backend alone.

## What now runs

The construct is chosen per dialect, in one emitter, so the escaping and the fold
stay a single code path (an unescaped wildcard is a filter bypass, P0 — #5567):

- **SQLite family → `GLOB`.** `LIKE`'s ASCII fold cannot be switched off per
  statement (`PRAGMA case_sensitive_like` is connection-global, so one query would
  redefine every other query on the connection), and `CAST(col AS BLOB) LIKE ?` was
  measured to match *nothing at all*. `GLOB` is case-exact and brings its own
  escaped class — `*`, `?`, `[` as the self-closing classes `[*]`, `[?]`, `[[]`,
  because SQLite's grammar gives `GLOB` no `ESCAPE` clause. `$icontains` keeps
  `lower()` on both operands, still ASCII-only.
- **Postgres → `LIKE`, unchanged.** Only the fold moved, from `LOWER()` to an
  explicit `translate()` over the 26 ASCII letters. Measured on a live PostgreSQL
  16 (ICU database): `LOWER('CAFÉ')` is `'café'` — the over-fold — while the
  `translate()` form leaves `É` alone.
- **MySQL → `LIKE` over `CAST(… AS BINARY)`**, so the comparison is byte-wise and
  no collation decides the case; `$icontains` folds byte-wise over the same binary
  rendering, which is ASCII-only because UTF-8 is self-synchronising.
- **Any other client** keeps the previous `LIKE` / `LOWER()` shape — it is the only
  form that still runs there — and is recorded as residue rather than left to be
  discovered.

`driver-turso`'s remote transport carries the twin (it compiles filters itself and
inherits nothing), and the two transports are now held to the same rows by a
parity suite that runs the shared `FILTER_TEXT_CASES` on both.

## Behaviour change — read this before upgrading

A filter whose comparand's case did not match the stored text used to match on
SQLite/turso/sqlite-wasm and may have matched on MySQL. It no longer does:

```ts
// rows: { id: '1', name: 'ACME Corp' }, { id: '2', name: 'acme corp' }
{ name: { $contains: 'acme' } }   // was ['1','2'] on SQLite → now ['2'] everywhere
{ name: { $icontains: 'acme' } }  // ['1','2'] — unchanged, and now correct on PG/MySQL too
{ name: { $icontains: 'café' } }  // was ['3','4'] on PG/MySQL → now ['4'] everywhere
```

If you were relying on `$contains` to ignore case, **write `$icontains`** — that is
the operator for it, and it now folds the same ASCII-only range on every backend.
Result sets only ever get NARROWER, never wider, so a filter that was already
correct stays correct.

## Why `minor` rather than `major`

No declared surface moves. `$contains` still exists, still takes the same
comparand, and `filter.zod.ts` is untouched — the case-sensitivity this delivers
was **already published** as the contract by #5701 (`FILTER_TEXT_CASES`, one
release earlier in this same v17 major), and the drivers were the half that had
not caught up. This is Prime Directive #12 applied in the direction it points:
declared = enforced. It is graded the way its sibling #5702/#6549 was graded for
the same operator family in the same rc cycle, and it registers nothing in the
ADR-0087 registries because it retires no authorable key.

## What is deliberately NOT in this change

`driver-memory` and `driver-mongodb` still fold case on their query paths — they
are the #5499 frozen family, so their `FILTER_TEXT_CASES` cells stay honest DEBT
and are tracked as #6682 (case sensitivity) and #6520 (`$icontains`). The
`service-analytics` SQL compilers were measured already compliant: they emit
Postgres-shaped statements, where `LIKE` is case-exact, and that assumption is now
written down and pinned rather than implied.
