---
"@objectstack/service-analytics": patch
---

fix(service-analytics): only a canonical numeric spelling is recovered as a number, so `'007'` / `'1.50'` stay strings (#5528)

An analytics `where` round-trips every comparand through the internal
`values: string[]` form — `stringifyForCube` on the way out, and
`coerceFilterValueForSql` / `coerceFilterValueForObjectQL` on the way back. The
decoder decided "this is a number" from the string's **shape** alone
(`/^-?\d+(\.\d+)?$/`), which cannot distinguish a number that was stringified on
the way out from a string the author actually wrote.

Measured before the fix, on cube `orders` / TEXT column `code`:

| author's `where` | leaf `values` | SQL bind | engine comparand |
|---|---|---|---|
| `{code: {$eq: '007'}}` | `["007"]` | `7` | `7` |
| `{code: {$eq: '0912'}}` | `["0912"]` | `912` | `912` |
| `{code: {$eq: '1.50'}}` | `["1.50"]` | `1.5` | `1.5` |

Both consumers were affected: the raw-SQL bind in `NativeSQLStrategy` and the
comparand handed to the ObjectQL aggregate engine.

The failure was **silent and mis-targeted, not empty**. Against a text column
SQLite applies the column's affinity to the integer bind, so a widget filtered on
order number `'007'` returned the row storing `'7'` — a different row, with no
error to read; on Postgres the same query is a `text = integer` type error, and on
the engine path the strict comparison simply matched nothing (measured: 0 rows).
Zero-padded and trailing-zero strings are ordinary business shapes — order
numbers, work orders, SKUs, dialling codes, postcodes, `'1.50'` prices.

Recovery is now limited to a number's **own canonical spelling**
(`String(Number(s)) === s`):

- a comparand that really was a number is `String(n)` by construction, so it
  still round-trips — `7` → `'7'` → `7`, `1.5` → `'1.5'` → `1.5`, `-3` → `-3`;
- a string `Number()` would rewrite — `'007'`, `'0912'`, `'1.50'`, `'1.0'`,
  `'-0'`, or more digits than a double holds — cannot have come from a number, so
  it stays the string the author wrote.

The narrowing can only ever **remove** recoveries: the shape regex still runs
first, so `'1e3'`, `'1e+21'`, `'+7'`, `' 7'`, `'0x10'`, `'Infinity'` and `'NaN'`
were strings before this change and are strings after it. This also aligns with
ADR-0053 D-A2, which demoted this textual type re-derivation to a last resort
behind the driver-backed `coerceTemporalFilterValue` hook.

**Stopgap, and named as one.** `values: string[]` still has no escape, so the
author strings `'null'` / `'true'` / `'false'` still collide with the tokens the
encoder writes for the real `null` and booleans. Making the round trip lossless —
tagged values, or an `unknown[]` internal representation — is #5526; the
collision is pinned as unchanged in
`src/__tests__/filter-value-canonical-number.test.ts` so it is not mistaken for
fixed.
