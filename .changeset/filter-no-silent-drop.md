---
"@objectstack/driver-memory": minor
"@objectstack/driver-sql": patch
---

fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

A filter the driver could not compile was **skipped**, not rejected. No predicate
was emitted and the query returned every row — the caller asked to filter and
silently received the unfiltered set.

The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
arrives at a driver only when `isFilterAST()` refused it — its operator is outside
`VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
was assigned to `where`. `driver-sql`'s loop then saw three *strings*, matched
neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
it cast every string to a logic keyword, opening three empty groups and returning
`{}` — a filter matching every record.

This is reachable from ordinary authoring, not just malformed input: `before` and
`after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
does not accept. Eight of the nineteen canonical view operators are in that
position, including `equals`; the others were masked only because ObjectUI's
adapter alias table happened to cover them.

**Behaviour change.** Both drivers now throw on a filter element that is neither a
logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
an operator it cannot express rather than dropping the condition. The nested and
`$`-object paths already threw on the same input, so this makes the three paths
agree. A caller that was relying on the old silence was receiving wrong results;
the error names the operator and the offending filter.

**`driver-memory` also gains seven operators it silently ignored:** `not_in`,
`is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
members of `VALID_AST_OPERATORS`, all previously falling through to
`default: return null`. `is_null` narrowed nothing instead of matching null rows.
Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
the two backends accept one vocabulary.

Migration: none for well-formed filters. If a query now throws, the filter was
never being applied — fix the operator (the message names it), or lower it to an
AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.
