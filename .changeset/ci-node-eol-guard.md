---
---

ci: fail the Node pin guard when the pinned runtime is out of support (#3825)

`check-node-version` proved all 18 workflows agree on a Node version. It would
have said `OK` just as cheerfully when all 18 agreed on **Node 20, three months
after that line went EOL** — which is exactly the state #3825 found the repo in.
Consistency was only half the invariant; the other half is that the thing they
agree on is still receiving patches.

The guard now also checks the pin's lifecycle:

- **past EOL → error.** An unpatched runtime is guarding every merge.
- **within 180 days of EOL → `::warning::`** on the PR, so the bump is scheduled
  work rather than an emergency. It stays a warning until support actually ends —
  failing months early would block unrelated PRs.
- **a major the guard has no dates for → error.** Adopting Node 26 forces you to
  record its dates rather than silently validating on an unknown runtime.

Dates come from `nodejs/Release` `schedule.json`, hardcoded deliberately: a
required gate must not depend on the network, and they move once a year.

The success line now reports the runway, which surfaces something worth knowing:

```
check-node-version: OK (18 setup-node step(s) across 16 workflow(s), all on Node 22).
  Node 22 is in maintenance; supported until 2027-04-30 (276 days).
```

**Node 22 entered maintenance on 2025-10-21** — Node 24 has been Active LTS
since 2025-10-28. Moving to 24 is now a one-line `.nvmrc` edit, and this guard
will list the workflows to follow. That is a separate decision; nothing here
forces it.
