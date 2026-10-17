---
"@objectstack/cli": minor
---

feat(cli): `os migrate organization-ownership --apply` certifies a database whose packages declare sharing rules — the declared sharing-rule mirrors this release's boot still seeds are reported as advisory, not as discrepancies

Clause-②: yes (widening — the apply report file, the plan file and both `--json` payloads gain an `advisory` field on a departure entry, and the run's `advisory` count includes that departure's rows)

- **What an operator saw.** On a v17 database whose packages declare sharing rules (HotCRM declares eleven), `--apply` ended with `complete: true` and `blocking: 11`, and never certified: the `adr-0131-organization-ownership` row of `sys_migration` kept `verified_at` null. The post-check waited for the `declared-rule-mirrors` departure on `sys_sharing_rule` to leave. That departure is the uncustomized `managed_by` `package` / `platform` rows with no organization. This release's own served boot writes those rows on every start, including the first v18 boot that the organization-ownership refusal stops, so they could never leave on this release.
- **What it sees now.** `--apply` reports `blocking: 0` and certifies: `verified_at` is set, with `blocking` 0 in the marker every reader checks. The mirror rows are named, counted and kept:
  - the plan and the apply print a warning before the first write: `sys_sharing_rule holds N organization-less row(s) of … which stay: …`. The plan file's and the report's `warnings` carry it too;
  - in the plan file and in the apply report (`--json` and the `--out` file), the `declared-rule-mirrors` entry of `tables[].departures[]` keeps `id`, `label`, `as` and `rows`, and gains `advisory`: why the rows stay, and what removes them. A departure without `advisory` still blocks;
  - `tables[].remaining` no longer counts these rows. The run's `advisory` and the ledger's `advisory` count them, beside the unattributable rows;
  - the rows keep `organization_id` NULL, so `sys_sharing_rule`'s `notNull` reads `willReceive: false` with `N row(s) stay NULL on this release, reported as advisory: …`. The plan file used to read `willReceive: true` for that table;
  - the human summary prints `N row(s) advisory, not held against certification — …` under the table. Its closing warnings name the unattributable rows and the advisory rows separately;
  - nothing is deleted. Every rule row stays as it was.
- **What still blocks.** Every other departure: `global-rung-move`, `template-promotion`, and a host fate supplement's own departures, even one named `declared-rule-mirrors`. Every other remaining row blocks too.
- **Already ran `--apply` and stopped at `blocking: 11`?** Plan again on this release, review the plan, and run `--apply` with it. This change leaves the inventory digest as it was, so a checkpoint recorded under this release's inventory resumes: only the post-check runs, and it certifies. A checkpoint recorded by a release whose inventory differed is superseded: every step runs again, each one idempotent, and the post-check certifies.
- **When blocking returns.** The release that retires the declared sharing-rule seeder (ADR-0131 D2) sets `DECLARED_SHARING_RULE_SEEDER_RUNS` to `false` in the same change. From that release on, these rows hold certification again until its ceremony deletes them.
