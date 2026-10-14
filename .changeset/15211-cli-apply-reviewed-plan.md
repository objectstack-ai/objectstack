---
'@objectstack/cli': minor
'@objectstack/spec': patch
---

feat(cli)!: `os migrate organization-ownership --apply` executes only the plan the operator reviewed (ADR-0131 D10)

Clause-②: yes (widening)

<!-- adr-0087: registered cli-organization-ownership-apply-plan-file-required -->

**BREAKING** (a narrowing of `--apply`'s accept set, released in 18.0.0-next.1), shipped as `minor` under the launch-window convention for breaking changes. It also widens the command: a new flag, `--plan-file`, new refusal reasons, and two new keys on the apply report.

`--apply` now requires `--plan-file FILE`, the plan file a plan run wrote. Before it writes anything, it compares that file with the plan it computes, and refuses when any of these differs:

- **The inventory digest** (`plan-digest-mismatch`). The fates it would run are not the ones the reviewed plan showed: a different `--fate-supplement`, or another release's inventory. Without this check, planning with supplement A and applying with supplement B ran B's fates unreviewed, including a mirror deletion A never listed.
- **The tenancy posture** (`plan-posture-mismatch`). The plan file records the posture it was computed under (`OS_TENANCY_POSTURE` / `OS_MULTI_ORG_ENABLED`), and the posture decides which rows attribution gives an owner and which it reports. A plan reviewed under a wall, which lists rows as reported, would otherwise give them owners when applied under `single`.
- **The database** (`plan-database-mismatch`).

The refusal names both values and the remedy: run the plan again with the same flags (or run the apply under the plan's posture), review it, and pass the new file. No flag skips the comparison.

A file that is not an organization-ownership plan, or that lacks its digest, posture or database, or cannot be read, is refused as `plan-file-unusable`. `--apply` without the flag is refused as `plan-file-required`. Both refusals come before the backup question and before the database is opened.

A checkpoint recorded under another digest is no longer discarded silently. The reviewed plan supersedes it: every step runs again (each is idempotent), and the apply report names the discarded checkpoint in `restartedFrom`, beside `reviewedPlan`.

## FROM → TO

| invocation | FROM (18.0.0-next.1) | TO |
|:--|:--|:--|
| `os migrate organization-ownership --apply --backup-taken` | performed the plan it computed at apply time | refused, `plan-file-required`: run `os migrate organization-ownership --out plan.json`, review it, then `--apply --backup-taken --plan-file plan.json` |
| `os migrate organization-ownership --fate-supplement host-fates.json --apply --backup-taken` | performed the plan it computed with that supplement | refused, `plan-file-required`: plan with the same `--fate-supplement`, then add `--plan-file plan.json` |
| `--apply … --plan-file plan.json`, where the file was planned with another supplement, release, posture or database | (no such flag) | refused with `plan-digest-mismatch`, `plan-posture-mismatch` or `plan-database-mismatch`, naming both values |

```bash
os migrate organization-ownership --out plan.json                                  # plan, then review plan.json
os migrate organization-ownership --apply --plan-file plan.json --backup-taken      # perform exactly that plan
```
