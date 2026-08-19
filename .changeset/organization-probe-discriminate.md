---
"@objectstack/objectql": patch
---

fix(objectql): a failed `sys_organization` probe stops reading as "this install has no organizations" (#9261)

`probeInstallOrganizations` — the read the #8844 system-write organization
resolution decides on — sat behind a bare `} catch { ids = [] }`. Every failure
answered with the count that means *none*, and `resolveSystemWriteOrganization`
maps 0 / 1 / 2+ organizations to *proceed unstamped* / *stamp the derived id* /
*refuse*. So one transient probe failure silently skipped **both** halves of the
2026-08-15 ruling:

- on a `single`-posture install that really has one organization, system-context
  inserts (a hook, a cron tick, a `runAs: system` flow) landed **unstamped** —
  filing the row under the `__global__` pseudo-tenant and forking exactly the
  per-organization autonumber counter and partitioned unique index the ruling
  exists to protect;
- on a multi-organization install, the refusal the ruling mandates
  (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`) **never fired** — fail-open on a
  guard that must be loud.

Aggravated by the memo: the invented answer was cached in
`organizationProbeMemo`, so the outage's consequence outlived the outage — every
later system write inherited "no organizations" until an organization write
happened to clear it.

The probe now discriminates by error TYPE, the disposition ADR-0110 D3 requires
("the probe found nothing" and "the probe could not run" are different facts):

- **benign** — `sys_organization` routes but its table was never provisioned
  (schema sync not run yet). It cannot hold a row, so zero really is the count,
  and first boot still proceeds unstamped. Asked through the shared
  `isMissingTableError` predicate (`@objectstack/metadata/errors`), the same call
  the file's sibling read seams make, never a hand-rolled code test.
- **everything else** — connection loss, pool exhaustion, a timeout mid-boot, a
  datasource that never connected, a permission denial — propagates with its
  envelope intact, and is **not memoised**. The write that asked fails loudly
  instead of being filed under a guessed topology, and the next write re-probes
  rather than inheriting the guess. No new error code and no new response field.

Measured rather than assumed: the old comment's "`sys_organization` may not be
registered at all (a lean embedding, a bare-kernel test)" is not a second benign
cause. An object missing from the registry does not fail the read at all on a
driver that tolerates an unknown table (`find` returns `[]` through the normal
path), a strict driver surfaces it as the missing table above, and an engine
with no driver fails the write on its own object one frame before the probe runs.
