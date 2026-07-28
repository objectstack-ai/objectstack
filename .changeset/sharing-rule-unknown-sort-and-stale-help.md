---
"@objectstack/driver-sql": patch
"@objectstack/plugin-sharing": patch
---

fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

`SqlDriver.find()` already recovered from a SELECT projection naming a column
the table lacks (retry with `select('*')`, the unknown field is simply absent
from each row). The identical failure one clause over — an **ORDER BY** column
the table lacks — fell through to `return []`. Because `count()` is a separate
statement, the list endpoint answered `HTTP 200` with `records: []` and
`total: 3`: the rows are there, none are shown, nothing is logged. Same family
as the `$`-param footgun closed by #2926.

It surfaced through the Console's sharing-rule **recipient picker**, which
never listed a single candidate. The client mangled `'name asc'` into
`0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
"no users exist", so no sharing rule could be authored from the UI at all.

Rows now outrank their order: the retry ladder drops the projection first (the
likelier culprit and the cheaper thing to lose), then the sort, then gives up.
A query that cannot be sorted comes back **unordered instead of empty**. Errors
that are not about an unknown column still propagate untouched.

**A rule authored in Setup now actually applies — and switching it off actually
withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
which only makes the rule reach records written FROM THEN ON. So an admin who
created a rule and enabled it saw nothing happen: the recipient's list stayed
empty until somebody happened to touch each record. The reverse was worse —
switching a rule OFF, or deleting it, left every grant it had already issued in
place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
restarts while the UI displayed the rule as disabled. The reconcile was reachable
only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

Each non-system write to `sys_sharing_rule` now also reconciles that rule's
grants, chained behind the existing rebind: insert/update run the same
diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
inactive), and delete purges directly via the new
`SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
through the plain data API used to orphan its grants. Seeding and package
bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
backfills those. Reconciliation is best-effort and never fails the write.

**The dialog's help text was engineering notes, shown to tenant admins.** The
field descriptions on `sys_sharing_rule` render under each input in Setup, and
they cited ADR numbers, table and column names (`parent_business_unit_id`,
`sys_business_unit`), enum machine values the dropdown never shows
(`business_unit`, `team`), a third-party library (better-auth), and engine
vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
admins to type an id or hand-write a `FilterCondition` after those inputs became
a record picker and a visual builder. Rewritten for the reader who actually sees
them — the implementation detail was already in the object's doc comment, which
is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
suffix for the same reason, and `active` can finally say what it now does:
turning it off withdraws the access.

Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
translation bundles, which still described `recipient_type` in terms of
`department` (the enum value is `business_unit`) and told admins to enter a
queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
option labels for `position` / `unit_and_subordinates` were translated as
"rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".
