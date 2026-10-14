---
'@objectstack/cli': patch
---

feat(cli): `os migrate organization-ownership --apply` executes only the plan the operator reviewed (ADR-0131 D10)

Clause-②: no

`--apply` now requires `--plan-file FILE`, the plan file a plan run wrote. Before it writes anything it compares that file with the plan it computes, and refuses when either differs:

- **Another inventory digest** (`plan-digest-mismatch`): the fates it would run are not the ones the reviewed plan showed. That happens with a different `--fate-supplement`, or with another release's inventory. Without this check, planning with supplement A and applying with supplement B ran B's fates unreviewed, including a mirror deletion A never listed.
- **Another database** (`plan-database-mismatch`).

The refusal names both digests (or both databases) and the remedy: run the plan again with the same flags, review it, and pass the new file. No flag skips the comparison.

A file that is not an organization-ownership plan, or cannot be read, is refused as `plan-file-unusable`. `--apply` without the flag is refused as `plan-file-required`. Both refusals come before the backup question and before the database is opened.

A checkpoint recorded under another digest is no longer discarded silently. The reviewed plan supersedes it: every step runs again (each is idempotent), and the apply report names the discarded checkpoint in `restartedFrom`, beside `reviewedPlan`.

`--apply` has not shipped in a release yet (its changeset is still pending), so no released invocation changes. The one-line form is:

```bash
os migrate organization-ownership --out plan.json                                  # plan, then review plan.json
os migrate organization-ownership --apply --plan-file plan.json --backup-taken      # perform exactly that plan
```
