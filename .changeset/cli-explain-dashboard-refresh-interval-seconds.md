---
"@objectstack/cli": patch
---

fix(cli): `explain` names the renamed `dashboard.refreshIntervalSeconds` (#14478)

The dashboard key catalogue `os explain` prints lists
`refreshIntervalSeconds` instead of `refreshInterval`, following the
`@objectstack/spec` rename of the authored key (the unit now lives in the key
name). Same key, same seconds; no other command output and no public surface of
this package changes.
