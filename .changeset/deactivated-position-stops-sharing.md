---
"@objectstack/plugin-sharing": minor
---

fix(security): a deactivated `sys_position` stops conferring sharing-rule record shares (#8710)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable
changes. `active` is a ROW property of a `sys_position` record, not a key on any
`packages/spec` schema, and no exported surface, stored metadata shape or
recipient vocabulary is added, renamed or retired. The change is a runtime read
at one call site inside `SharingRuleService`; the remedy for an affected
deployment is operational (re-activate a position whose shares are still meant
to flow), not a metadata migration. -->

**BREAKING for deployments that already deactivated a position named as a
sharing-rule recipient.** Their `sys_record_share` rows are revoked on the next
evaluation of that rule.

#8613 made `sys_position.active` real at the authorization DERIVATION seam: a
deactivated position stops carrying its permission sets and its name leaves
`context.positions`. A sharing rule reaches users by a **second road that never
passes that seam** — `SharingRuleService.expandRecipient` → `PositionGraphService`
— so a rule sharing records with `cfo` kept sharing them after `cfo` was
deactivated, while the `deactivate_position` dialog promises, unqualified:

> Deactivate this position? Users keep their assignment but the position stops
> granting permissions until re-activated.

A record share is access, so the promise covers it. Maintainer ruling,
2026-08-15, verbatim: **"Access-conferring paths filter deactivated positions;
addressing paths do not."**

**What changes at runtime.** When a sharing rule's recipient is a position, the
evaluator reads the `sys_position` catalogue row and, if it is explicitly
deactivated, the rule expands to **nobody**:

- no new shares are materialised for that position's holders;
- the shares it had already materialised are **revoked** on the next
  reconcile — by `evaluateRule`, by the per-record hook pass, and by the
  synchronous recipient-axis revoke (#7729) — because a rule that confers
  nothing has an empty desired set and every existing grant is stale;
- the verdict is read with `isRowActive` (`@objectstack/core`), the same
  predicate #8613 established, so the 1/0 and `'false'` storage shapes every
  driver produces are judged identically.

This is **not** a refactor and **not** a no-op: it changes who receives record
shares.

**What deliberately does NOT change**, per the same ruling:

- **approval ROUTING** keeps reading the raw directory — filtering there is
  fail-OPEN (an approval step routing to nobody), #8613's carve-out, reaffirmed;
- **write gates and blast-radius reads** (`assertAudienceAnchorBindingGate`,
  `setsBoundToPosition`, the delegated-admin surfaces) stay unfiltered, because
  dropping a deactivated row there would make a refused binding permitted and
  narrow a delegate's boundary — access *widening*;
- `PositionGraphService.expandPositionUsers`, the ADDRESSING primitive, is
  untouched: the filter is at the sharing call site, so moving it down into the
  helper would take the paths above with it. A pin fails if it ever does.

**Rows that keep granting exactly as before:** a position whose `active` column
is absent or NULL (the predicate is "explicitly deactivated", never "explicitly
active"), a recipient name with no `sys_position` row at all (the
`sys_member.role` transition source of ADR-0057 D4), and a position whose
same-name row was deactivated in *another* organization — `sys_position.name` is
unique per organization (#8468), so the flag is read off this rule's own
tenant's row.

**Cost.** One `sys_position` read per distinct position per evaluator pass,
memoised for that pass only (a memo outliving the pass would make a deactivation
take effect late). The ruling accepted the extra read explicitly; the sibling
seam in #8613 needed none because both tables were already at hand there.

**Before upgrading**, list the deactivated positions and check whether any is a
sharing-rule recipient whose shares are still meant to flow — re-activate those,
or move the grant onto the rule:

```
GET /api/v1/data/sys_position?filters=[["active","=",false]]
GET /api/v1/data/sys_sharing_rule?filters=[["recipient_type","=","position"]]
```
