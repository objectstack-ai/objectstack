---
'@objectstack/organizations': patch
---

The organization seed ownership claim now owns every owner-less row, not only the first 10,000 of each object

Clause-②: no

`claimOrgSeedOwnership` hands an organization's owner-less seeded rows to the organization's owner. It read at most 10,000 owner-less ids per object and updated them one at a time, and nothing read again. The default-organization bootstrap runs the claim once (the ADR-0093 D7 once-gate), so on an object with more than 10,000 owner-less rows in one organization the rest stayed owner-less for good. Measured on a real engine over the SQLite WASM driver: 10,500 owner-less rows, one pass, 10,000 owned and 500 left.

The claim now re-owns each object's owner-less rows with one predicate write (`owner_id = owner` where `organization_id = org` and `owner_id` is null), the shape the single-tenant claim `claimSeedOwnership` in `@objectstack/plugin-security` already uses.

- **Every owner-less row is owned after one pass.** When an object has more rows than one write may fire per-row hooks over (the engine's per-row hook ceiling, 10,000), the engine refuses the write and nothing is written. The claim then re-owns one page of 5,000 rows and tries the whole remainder again, until no owner-less row is left.
- **The returned count is every row claimed.** `count` in each `{ object, count }` entry is the sum of the affected-row counts of every write the claim made for that object.
- **Same scope and the same write context.** Only this organization's rows with no owner are written, a page write included. Every write still runs with `{ isSystem: true, skipAutomations: true }`: no hook bound from app metadata and no record-change flow runs, and hooks that plugins register in code (audit, capability gates, the sharing projection) still run once per claimed row.
- **The claim reads only when it pages.** Below the ceiling it issues no read: the write's own predicate selects the rows. The page read, when there is one, is a plain system read.
- **A failure now costs the write, not one row.** A hook or validation rule that refuses a predicate write refuses all of it, so that object's rows (or that page) stay owner-less and the claim logs a warning naming the object and how many rows it had already claimed. Other objects are still claimed.
