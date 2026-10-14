---
'@objectstack/cli': minor
---

feat(cli): `os migrate organization-ownership --apply` — the v18 organization-ownership ceremony's apply step and post-check (ADR-0131 D10, ceremony items 2 to 4)

Clause-②: yes (widening)

The command that planned the ceremony now performs it. Without `--apply` nothing changes: the read-only plan, written to a file. With `--apply`:

- **The backup comes first.** It is the operator's act: pass `--backup-taken`, or answer yes at the prompt. A non-interactive run without the flag is refused before the database is opened.
- **The fates run in order**, each step stopping the run where it meets a blocker:
  1. **Attribution** — every NULL `organization_id` row the plan derives an owner for takes it (a parent, subject or holder anchor; under `single`, the Default Organization). A row with no derivable owner is never assigned one: it stays NULL and is listed by id.
  2. **Authored catalog rows** — permission sets and positions an organization authored in Setup become environment metadata through the metadata door (under `single`; under a wall they are reported), with each position's binding rows carried into its `permissionSets`.
  3. **The verified id→name rewrite** — every `sys_user_permission_set` grant names its set in `permission_set`, then every grant is verified to name a set the security catalog resolves. `permission_set_id` stays.
  4. **Mirror deletion** — only after that verification, read again just before the first delete: the seeded catalog copies (per organization and NULL residue), the binding rows, seeded capabilities and seeded templates. Authored, customized and organization-stamped rows stay.
  5. **Column drops** — `organization_id` leaves the deployment-level objects through the schema-drift ceremony (`os migrate apply`'s machinery), never a hand `ALTER`. A table whose rows still need another step keeps its column, and the run says why.
- **Idempotent and resumable.** Every write is conditioned on the state it changes, and each finished step is checkpointed in `sys_migration` (row `adr-0131-organization-ownership`); a run interrupted mid-step resumes at that step and never re-derives an owner already written.
- **The post-check** re-reads the plan and reports, per table, what remains. The ledger row records `applied_at` once every step has finished and `verified_at` when the post-check also reads zero discrepancies. Exit code 1 while the ceremony is unfinished or the post-check finds a discrepancy.
- A JSON report is written beside the plan (`organization-ownership-apply-TIMESTAMP.json`, or `--out`); an existing file is never overwritten.

```bash
os migrate organization-ownership --out plan.json            # read the plan first
os migrate organization-ownership --apply --plan-file plan.json --backup-taken   # then perform exactly that plan
```
