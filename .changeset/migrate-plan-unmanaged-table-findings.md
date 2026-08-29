---
"@objectstack/cli": minor
---

feat(cli): `os migrate plan` reports the platform-namespaced tables no declaration accounts for (#13204)

`detectManagedDrift()` diffs the tables metadata DECLARES against the physical
database, so a table nothing declares is not in its input and no plan can ever
mention it. Every object retirement therefore strands its table forever, and
the plan reads clean while it sits there — measured on ObjectStack Cloud's
control DB, where a retired `sys_scim_provider` is still present (0 rows) and
has never appeared in a plan.

`os migrate plan` now sweeps the physical table catalog once per run (one
`sqlite_master` / `information_schema.tables` SELECT against the same driver it
diffed) and reports the BASE TABLES that carry a reserved platform namespace
prefix — `PLATFORM_OBJECT_PREFIXES`, i.e. `sys_` / `cloud_` / `ai_` — and that
no declaration accounts for. Human mode prints a block only when there is
something to report; `--json` grows an `unmanagedTables` key that is **always
present** once a SQL driver was found, so a consumer can tell "swept, everything
is declared" from "never swept".

⛔ **Nothing is dropped, and no drop is proposed.** The section names tables and
stops. Removing an existing physical table is destructive and hard to reverse;
that decision stays with a human and this change does not introduce it.

⛔ **It is not `composition.coverage`.** Coverage says what the plan EXAMINED of
what the deployment declares; this says what EXISTS that no declaration
accounts for. A declared-but-unexamined object's table is deliberately excluded
here — coverage already reports it, and folding the two together would make
"examined and clean" indistinguishable from "never looked at".

**Why the predicate is not a bare `sys_` prefix scan.** Three physical-table
families carry a platform prefix while being legitimate, and a difference
against the managed set alone reports all three: rotation shards
(`sys_activity` declares `strategy: 'rotation'` with 14 daily shards, and only
the BASE name is ever a `managedObjectFields` key — up to 14 false rows on
every plan of every `plugin-audit` deployment); declared-but-unexamined objects
(~72 of them on the control plane #13028 measured); and driver-internal tables.
Shards are folded onto their base before the membership test, the declared set
is unioned into the managed set, and the driver's own scratch tables
(`_objectstack_sequences`, `__os_mig_*`) carry no reserved prefix.

Every path that fails to obtain an answer reports `status: 'unreadable'` with a
reason — a missing seam, an unrecognised dialect, a catalog read that threw, a
seam that returns no result set — and never an empty list. Non-SQL drivers are
unaffected: `plan` already returns before this point when no SQL driver is
active.
