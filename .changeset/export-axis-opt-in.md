---
"@objectstack/spec": major
"@objectstack/plugin-security": major
"@objectstack/plugin-reports": major
"@objectstack/plugin-hono-server": minor
---

feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

**BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
record and taking a bulk machine-readable copy of the whole table are different
privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
"Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

### Migration — FROM → TO

| | before | after |
|---|---|---|
| `allowExport` unset | export **allowed** (inherited read) | export **denied** |
| `allowExport: false` | export denied | export denied (unchanged) |
| `allowExport: true` | export allowed | export allowed (unchanged) |

**The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
wildcard) of every permission set whose holders should keep exporting.

```ts
objects: {
  deal: { allowRead: true, allowExport: true },   // ← add the grant
}
```

Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
that never exported is unaffected.

**Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
built-ins are handled for you — `admin_full_access` and `organization_admin` now
carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
custom set whose users export must be edited. `member_default` deliberately does
NOT carry the grant, so ordinary authenticated users lose export until an admin
grants it — that is the point of the flip, not an oversight.

**Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
granting `true` grants export. `false` and unset are the same outcome; `false`
is authoring intent, not a veto, because permission sets are additive capability
containers (ADR-0090).

**Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
longer confer export. Separating "may see all data" from "may take a bulk copy"
is the segregation-of-duties case the axis exists for.

### Also in this change

- **spec** — a set carrying `allowExport` is now **high-privilege**
  (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
  `guest` audience anchors. Without this the opt-in was defeatable by binding an
  export-granting set to `everyone`. One predicate, so the runtime anchor gate,
  the `@objectstack/lint` security-posture rule and the install-time suggestion
  surface all pick it up together.
- **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
  `explain` can answer *why* a caller got `403 EXPORT_NOT_PERMITTED`. It
  explains as `read ∧ the export grant`: `object_crud` reports the conjunction
  and attributes the granting set, while every data-shaped layer
  (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
  as the `find` the export actually performs — asking the RLS compiler about an
  `export` operation would match no policy and wrongly report "no RLS applies".
  `readFilter` is surfaced for `export` as it is for `read`.
- **plugin-reports** — closes the reports side door (#3710). A report rendered
  as `csv`/`json` is the same bulk copy of the same object, so it is gated by
  the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
  interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
  `scheduleReport` additionally refuses at create time so an author is not told
  at 3am. A schedule created while granted stops delivering once the grant is
  revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
  Deployments without `plugin-security` are unaffected (no permission sets
  exist, so the axis does not apply).

<!-- adr-0087: registered export-axis-opt-in -->
