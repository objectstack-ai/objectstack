---
"@objectstack/lint": patch
---

fix(lint): the three ADR-0120 uniqueness rules name the object in the `where` slot instead of repeating the config path (#9600)

`AuthoringFinding` declares two location slots with different jobs — `where`
("human-readable location", e.g. `object "leave_request"`) and `path` ("config
path", e.g. `objects[3].sharingModel`). Three registry adapters set the first
from the second (`where: f.path`), so every CLI command printed the same
positional string twice and the only human-readable slot said nothing the `at`
clause did not already say:

```
• objects[44].indexes[1]: "sys_account" declares index [provider_id, account_id] with bare `unique: true` …
      rule: unique/unscoped-declared-index  at objects[44].indexes[1]
```

That index is a position in the MERGED object array, which appears in no file
the author wrote. `unique/unscoped-declared-index`, `unique/double-declaration`
and `unique/legacy-organization-composite` now spell it the way the rest of the
table does:

```
• object "sys_account" · index [provider_id, account_id]: "sys_account" declares index …
      rule: unique/unscoped-declared-index  at objects[44].indexes[1]
```

An index is identified by its `name` when it has one, and otherwise by the
columns the author actually wrote (`· index [provider_id, account_id]`) — both
searchable in their source, which a bare ordinal is not.

`where` is stated by the rule functions themselves rather than reconstructed in
the adapter, because only the rule still holds the object it walked. Their
return type is now `LocatedLintIssue` (a `LintIssue` with a REQUIRED `where`),
newly exported, so a fourth rule joining this family cannot reach the adapter
without one — a `f.where ?? f.path` fallback at the adapter would have let the
positional spelling ship again silently.

Display text only, and the rules' population is unchanged: measured over the 45
object declarations `@objectstack/platform-objects` and
`@objectstack/metadata-core` ship, the registry produced 1050 findings from the
same 5 rules before and after, with the count of findings whose `where` was a
bare config path going 72 to 0. `path` is deliberately untouched and stays
positional — it is the slot that is supposed to be a config path, and the
runtime gate's `fingerprint` reads `where` and `path` together, so making
`where` more specific cannot merge two findings that were distinct.
