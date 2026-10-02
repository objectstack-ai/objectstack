---
'@objectstack/plugin-security': patch
'@objectstack/service-analytics': patch
---

Row-level security policies and the analytics native-SQL path judge a comparand against a declared boolean field by the platform's boolean-comparand rule, the one the data engine's `where` already applies

Clause-②: no

- **Row-level security (`@objectstack/plugin-security`).** A compiled `using` / `check` predicate on a `boolean` or `toggle` column (or a `formula` returning `boolean`) is judged by `booleanComparandDoorVerdict` from `@objectstack/spec/data`, in the same pass as the number rule. `'true'` / `'false'`, `'1'` / `'0'` and `1` / `0` are read as the boolean each names. Anything else the rule refuses (a string such as `'yes'`, `'TRUE'` or `''`, a number other than `1` / `0`) drops the policy as a refused comparand: the read is filtered by the deny sentinel, the write is refused 403, and the WARN line names the clause, the field and the position. Before, `record.flag != 'true'` kept every row on SQLite and the write check admitted every row, so the exclusion the author wrote was not applied.
- **Analytics native SQL (`@objectstack/service-analytics`).** The query's `where` (and the dataset query's `runtimeFilter`, which is merged into it), each measure's own `filter` and a dataset's own `filter` are judged by the same rule before the statement compiles. An accepted spelling is read as its boolean, and anything else the rule refuses is refused `INVALID_FILTER` / 400 with the rule's own message, before any statement runs. The native strategy now answers what the engine-aggregate strategy answers. Before, `{ flag: 'true' }` counted no rows on SQLite, `{ flag: { $ne: 'true' } }` counted every row, and `{ flag: 'yes' }` answered 200.
- **What you may notice.** A policy or analytics filter that compared a boolean field with a value outside the accepted set now refuses instead of answering. Write `true` / `false`. A policy `record.flag == 1` now admits writing a `true` row, which its read already showed.
- No export, type or error code changes.
