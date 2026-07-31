---
---

docs(adr-0104): amend the upgrade-path advertisement clause to record how it landed (#4253/#4284) — `os migrate meta` names the migrations without gate status, because gate status is per deployment (2026-07-27 addendum) while `meta` acts on source, which deploys to zero-or-N of them; status is reported where a datastore is actually open. Releases nothing.
