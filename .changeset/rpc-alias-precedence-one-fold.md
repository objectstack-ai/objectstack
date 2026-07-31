---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
---

fix(spec,data): the five RPC query aliases resolve by ONE fold — spec table, not per-reader prose (#3795)

`RpcQueryOptionsSchema` accepts five legacy aliases next to their canonical
QueryAST keys and stated the precedence in prose only ("the normalizer uses
the new key"). With no fold in the schema, every reader re-implemented it —
the #3713 condition — and the two readers disagreed:

| pair | spec prose | runtime dispatcher | metadata-protocol |
|---|---|---|---|
| `where` > `filter` | canonical | canonical | **alias consulted first** |
| `fields` > `select` | canonical | canonical | **alias clobbered canonical** |
| `offset` > `skip` | canonical | canonical | **alias clobbered canonical** |
| `expand` > `populate` | canonical | — | **alias consulted first** |
| `orderBy` > `sort` | canonical | canonical | canonical |

Four of five inverted in `protocol.ts`, so `?select=a&fields=b` answered
`[a]` on one path and `[b]` on the other — reachable from a plain HTTP
request.

**The mapping now lives once, in the spec** (`RPC_QUERY_ALIAS_SLOTS` +
`foldQueryAliasSlots`, both exported), under the rule #4181 already
established for the filter pair:

- an **alias alone** folds into its canonical key — `filter`→`where`,
  `select`→`fields`, `sort`→`orderBy`, `skip`→`offset`, `populate`→`expand` —
  and the alias key is **dropped from the parsed output**;
- **both spellings, same value**: redundant, tolerated, alias dropped;
- **both spellings, different values**: irreconcilable — picking a winner IS
  the silent drop — so the parse fails (schema) / the request is `400
  INVALID_REQUEST` (wire), naming the spellings and the canonical key;
- an explicit **`null` spelling is a withdrawal**, never a conflict: a null
  alias is dropped silently, a null canonical keeps its slot-specific answer.

`RpcQueryOptionsSchema` and the four `filter`-mixin option schemas
(update/delete/count/aggregate requests) apply the fold as a parse transform,
so parsed output speaks canonical keys only — a TS consumer reading
`parsed.query.populate` now **fails to compile** instead of silently reading
`undefined` (the #3742 / #3764 shape, one layer down; hence the minor). The
protocol normalizer folds raw wire input by the same table (extended with the
wire-only `filters` / `$filter` / `$expand` spellings), and the runtime
dispatcher's second copy of the fold is deleted outright.

**Authoring/callers unchanged for the supported cases**: every alias alone
keeps working on every path, and identical duplicates still pass. What
changes is mixed vocabularies with **different** values — previously answered
differently per route, now refused loudly on all of them — and a direct
`expand: [names]` array on `POST /data/:object/query`, which used to be read
by its indices ("Unknown field '0'") and now lowers to the expand record like
`populate` always did.
