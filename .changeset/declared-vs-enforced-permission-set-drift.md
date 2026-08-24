---
'@objectstack/plugin-security': minor
'@objectstack/rest': minor
---

Surface "declared ≠ enforced" on package-declared permission sets, and give
operators a sanctioned, audited way to discard a stale environment overlay.

Field report: an rc→GA upgraded environment can freeze a package's
permission set at a stale snapshot while the shipped artifact keeps
shipping grant changes — silently, with only a boot log counter as a
signal. Two independent mechanisms can cause this, and either (or both
together) can be live on one row:

- **overlay shadow** — a Studio permission-matrix save on a package-declared
  set materializes a `sys_metadata` overlay that shadows every later package
  edit to that set, forever, surviving redeploys and restarts;
- **provenance skip** — a `sys_permission_set` row whose `managed_by` column
  predates package provenance tracking is treated as environment-authored
  and never reconciled with the package.

`sys_permission_set` now carries `drift_status` / `drift_detail`, recomputed
every boot, naming the set and the cause — a new "Needs Attention" Setup
list view surfaces only sets that actually differ from their shipped
artifact (an in-sync set is never flagged; `drift_status` stays `null`).

A new "Discard Overlay" Setup action (`POST
/api/v1/security/permission-sets/:id/discard-overlay`) removes a stale
overlay and resyncs the record to the current artifact synchronously — the
supported, audited counterpart to the raw-SQL remediation the field report
had to use. It targets package-declared sets only: a set with no current
package declaration is refused, so a genuinely environment-authored set can
never be discarded by name collision.

Boot-time auto-adoption of legacy rows and a bulk `os meta
adopt-permission-sets` command remain out of scope (2026-08-20 maintainer
ruling) — the manual SQL adoption recipe stays documented for the rc→GA
provenance-skip case; see the ops runbook.
