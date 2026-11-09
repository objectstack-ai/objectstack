---
'@objectstack/objectql': patch
'@objectstack/cli': patch
---

feat(objectql, cli)!: the record-currency code backfill runs one organization at a time, and the home-amount recompute takes the same organization filter

Clause-②: yes (narrowing) — `backfillRecordCurrencyCodes` (and `os migrate record-currency-codes`) given no organization over the rows of more than one organization is refused with `400 VALIDATION_ERROR` (`field: 'organizationId'`) before any write, where it wrote the one code into every organization's codeless rows; widened beside it: the optional `organizationId` and `allOrganizations` options and the `--org` / `--all-organizations` flags, and `recomputeHomeAmounts`'s optional `organizationId` with `os migrate recompute-home-amounts --org`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is converted: an operator's run of a data command over several organizations is refused until it names its scope, which is a choice of currency per organization made by hand, not a mechanical conversion -->

**BREAKING** for an operator who runs `os migrate record-currency-codes` (or calls `backfillRecordCurrencyCodes`) without naming an organization on a database whose rows of that object belong to more than one organization.

- **Why (ADR-0144 Open item 13).** Each organization has its own home currency (`localization.currency`), so the one code a run writes is right for the rows of at most the organizations that use it. Before this release the run wrote it into every organization's codeless rows, silently wrong for the others.
- **One organization.** `--org ID` (`organizationId`) fills only that organization's rows: the walk and every write run under `{ isSystem: true, tenantId: ID }`, and the walk also filters on each row's own `organization_id`, because the system context alone narrows the driver only under a walled tenancy posture. The report counts per organization (`organizations`).
- **Refused, and what it says.** With neither `--org` nor `--all-organizations`, the rows are first counted read-only; when they belong to more than one organization the run (a dry run as well as `--apply`) exits 1 before any write. The refusal lists each organization's codeless row count, and under `--json` carries them in `organizations`. The code is still never derived: no organization's `localization.currency` is read to pick one (ADR-0144 D8 rule 4).
- **Every organization, explicitly.** `--all-organizations` (`allOrganizations: true`) writes the one code into every organization's codeless rows, as an unscoped run did before. `--org` with `--all-organizations` is a usage error; the engine refuses both options together with `400 VALIDATION_ERROR`.
- **Unchanged.** A database whose rows of the object belong to one organization, or name none, runs exactly as before, with the same report text.
- **The recompute.** `os migrate recompute-home-amounts --org ID` (`recomputeHomeAmounts`'s `organizationId`) limits the run to that organization's rows, read and written as it, and records the organization in the run's audit entry. Without it the run still covers every organization, each in its own home currency, and is never refused for that: it writes no value the operator chose. Its `code_blank` remedy now names `--org`.
- **Who moves, and the fix.** A script that ran the backfill once over a multi-organization database runs it once per organization with `--org ID` and the code that organization's rows are in, or adds `--all-organizations` when one code really is right for all of them.
