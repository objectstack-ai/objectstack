---
"@objectstack/lint": patch
"@objectstack/cli": patch
---

feat(lint): warn on replay-unsafe `mode: 'insert'` seed datasets (#3434 follow-up)

Seeds are replayed — they re-load on every dev-server boot and every package
re-publish, not applied once — so `mode: 'insert'` (the loader's one mode with
no existing-row check) duplicates its table on every restart. That footgun
shipped undetected until #3434 (showcase memberships grew 3 → 6 → 9).

Adds `validateSeedReplaySafety` to `@objectstack/lint` (a pure `(stack) => Finding[]`
rule, ADR-0019) and wires it into `os validate` / `os lint`. Every `data[]` seed
declared with `mode: 'insert'` now gets an advisory warning that points at the
idempotent modes (`ignore` / `upsert`) and the `externalId` to match on — a
single natural-key field, or a COMPOSITE list of fields for a join / junction
table with no single key (`['team', 'project']`, the support #3434 added). It
catches the mistake at authoring time instead of on the second boot.
