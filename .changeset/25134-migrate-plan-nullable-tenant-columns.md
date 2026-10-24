---
'@objectstack/cli': patch
---

feat(cli): `os migrate plan` lists the tenant columns still nullable and names the voluntary organization-ownership ceremony; the ceremony reports a rotation shard already NOT NULL as such (#25134)

Clause-②: yes (widening) — `os migrate plan --json` gains the `nullableTenantColumns` field, and the ceremony's `not-null` step gains the `already-not-null` outcome and the `alreadyNotNull` summary count. No exit code, drift entry, op, refusal or accepted input moves.

Metadata-protocol: none

A database the published 18.0.0 created is certified at birth with its tenant columns (`organization_id`) nullable, and `os migrate organization-ownership`, which tightens them to `NOT NULL`, is voluntary on it. Nothing told the operator that.

- **`os migrate plan`: a new advisory section.** It lists every tenant column the database still holds nullable (table and column) and names `os migrate organization-ownership` as the remedy. Each column says whether the ceremony tightens it or leaves it, and why. The ceremony leaves a rotation shard created before shards were created `NOT NULL`, `sys_email_template` (its rows are mirrors the ceremony deletes, and the table retires), a table its inventory exempts, and every table on a database whose transport cannot rebuild a table (the Turso remote face). When the ceremony would tighten none of the listed columns, the section says so and does not offer it. A fresh install lists nothing. A column named `organization_id` on an object with tenancy disabled (`sys_sso_provider`) is not a tenant column and is not listed.
- **Advisory only.** It is not drift: it proposes no change, adds nothing to `total` or `changes`, and the exit code does not change. Under `--json` it is the separate field `nullableTenantColumns`: `{ status: 'read', adr, remedy, columns: [{ table, column, database?, ceremony: 'tightens' | 'leaves', reason? }] }`, or `{ status: 'unreadable', adr, detail }` when the plan could not read it.
- **The ceremony's `not-null` step.** A rotation shard that the driver created `NOT NULL` used to be reported as `unsupported`, with a note saying each new shard is created nullable. That has not been true since the driver began creating shards `NOT NULL`. Such a shard is now `already-not-null` (counted in `alreadyNotNull`) and gets no note. A shard rotated in before then stays `unsupported`, and its note says it is dropped when its period leaves the base table's retention.

**What to do.** Nothing is required: the server starts either way. To tighten the columns the plan lists, run `os migrate organization-ownership --out PLAN`, review it, then run `os migrate organization-ownership --apply --plan-file PLAN --backup-taken`.
