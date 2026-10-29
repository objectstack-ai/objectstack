---
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
---

fix(rest): `GET /meta/diagnostics` refuses an unknown type, severity or package instead of answering an all-clear, and keys an alias's stats by its canonical type (#27514)

Clause-②: no (narrowing — owes one contract-review-tier review before the queue)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The narrowed face is a REQUEST to one read door: query values that were never honoured (an unknown type, severity or package) are now refused instead of answered with an empty sweep, and an alias's stats move to the canonical key the sweep already listed it under. No stored metadata, package source or object definition holds a diagnostics request or response, no schema key or export changes, and the remedy is the caller's own query string, so there is nothing for `objectstack migrate meta` to rewrite. -->

`/meta/diagnostics` is the door an author, an agent or CI reads to learn whether metadata is healthy, and three query values it could not honour were answered `200` with zero issues.

- **`?type=`** naming no metadata type (`zzz_unknown`) is refused with `400 INVALID_REQUEST`, by the same verdict `GET /meta/:type` uses: the platform's static type spelling, then the types this deployment carries live. A near-miss spelling of a declared type (`viewes`) keeps its existing refusal, which names the spellings it was reaching for.
- **`?severity=`** other than `error` or `warning` is refused with `400 INVALID_REQUEST`. An empty value still means the default, `error`.
- **`?package=`** naming a package that is not installed, and that no swept item is bound to, is refused with `400 INVALID_REQUEST`. An installed package with no items still answers its zeros, items bound to an uninstalled package are still swept, and `package=all` still sweeps every package.
- **An alias** (`?type=views`) is swept and keyed in `stats` and `entries` under its canonical type (`view`), so it answers exactly what `?type=view` answers.
- **One envelope.** Every refusal of this route now answers the nested `{ error: { code, message } }` the repeated-parameter refusal already used. The near-miss type refusal used to answer `{ error: '…', code }`.
