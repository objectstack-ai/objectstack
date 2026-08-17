---
"@objectstack/cli": minor
---

feat(cli): `os migrate duplicates` — an operator-facing inventory of the business identifiers the tenancy split already minted twice (#8928)

Two producers of untenanted rows have been closed (#8686's seed loader plus its
one-shot backfill, and #8844's runtime system-context write). Neither touches
the **damage already done**, and both rulings say the same thing about it: a
business identifier that has already been handed out — on an invoice, in a
notification, in another system's idempotence key — is not the platform's to
rewrite. What an operator needs instead is to know **which ones they are**.

```bash
os migrate duplicates                        # the whole report, JSON on stdout
os migrate duplicates > duplicates-2026-08-17.json
os migrate duplicates --object crm_case      # narrowed (and the report says so)
```

**Run it BEFORE the #8686 backfill is applied.** The evidence is perishable:
`organization_id = NULL` is the marker that says "this row came from the
untenanted side", and it is exactly what that repair overwrites. The repair also
merges and deletes the `__global__` counter, which is the report's only
forward-looking line — an install that repairs before reporting can never
produce it again. The command itself applies nothing: it boots read-only (no
DDL, no seed, no database file brought into existence) and issues SELECTs only.

What the report contains, per the 2026-08-16 maintainer ruling on all five of
the card's decision points:

- **one row per duplicated value, with its holders** — id, organization,
  partition and creation timestamp per row, so the operator can decide case by
  case rather than per value. JSON on stdout, no persistence and no new schema:
  the operator archives it;
- **the narrow definition of duplicate** — a value held by rows in more than one
  of the partitions `COALESCE(organization_id, '__global__')` separates
  (ADR-0120 D3). A value repeated *inside* one partition is refused by the
  partitioned unique index and is not reported;
- **the live condition too** — an object still running a `__global__` counter
  beside an organization-scoped one is about to mint more duplicates;
- **a data-side probe** — `GROUP BY <field> HAVING COUNT(*) > 1` over the
  object's own table, never an enumeration of `_objectstack_sequences`, so a
  duplicate whose counter was since merged is still found. The counter table is
  read for the live condition alone, because that fact lives nowhere else.

Scope is every registered object that is organization-scoped, and on it every
`autonumber` or `unique` field. `sys_` / `cloud_` / `ai_` objects are **not**
filtered out — that filter is correct for a repair (platform seeds stay global
by design) and wrong for a report, which must not silently omit a real
duplicate. Anything that could not be probed is listed in `skipped` with the
driver's own message, so a target the command could not read never reads as a
target with no findings; a driver with no raw-SQL seam refuses loudly and exits
non-zero rather than reporting zero duplicates.

⛔ Reporting is all it does. Renumbering, deduplicating or otherwise rewriting an
already-minted identifier stays out of scope per both rulings.
