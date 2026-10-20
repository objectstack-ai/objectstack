---
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-approvals': minor
'@objectstack/metadata-protocol': minor
---

feat(plugin-sharing,plugin-approvals,metadata-protocol)!: the organization-less readers of sharing rules, approval units and the seed loader retire (ADR-0131 D2/D8, 18.x step 7)

Clause-②: yes (narrowing): a declared sharing rule served under `single` gains the `deploymentWide: true` key on the wire in place of `organization_id: null` (widening); the sharing-rule admin reads, the approval unit screen and the scoped seed pre-load stop reading rows with no organization (narrowing). A declared rule keeps applying deployment-wide; nothing an author declares is refused.

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The data migration a database with organization-less rows needs is the operator's ceremony, `os migrate organization-ownership`, stated below; the 18.x boot refusal already names it. The one wire change is a declared sharing rule's response row (`deploymentWide: true` in place of `organization_id: null`), not an authorable key. -->

**BREAKING** — readers narrow. On a certified database (every 18.x database: a fresh install, or one the organization-ownership ceremony upgraded) none of these readers has a row left to find; they matter only to a database that still holds organization-less rows, which 18.x refuses at boot.

- **A declared sharing rule is deployment-wide by a typed marker, never a NULL organization.** Under `single` it is served as one projection carrying `deploymentWide: true` and no `organization_id` key (was `organization_id: null`); its criteria sweep carries no tenant (the predicate ADR-0131 D8 computes under `single` is none) and each grant is stamped with its record's organization. Under `group` / `isolated` it is served once per organization, exactly as before. FROM `rule.organization_id === null` TO `rule.deploymentWide === true` for any client that told a declared rule apart by its NULL organization (`GET /api/v1/sharing/rules`, `GET /api/v1/sharing/rules/:idOrName`).
- **A stored sharing rule with no organization sweeps nothing and grants nothing** where the deployment registers the organization object, reported once at `error` with the remedy (run the organization-ownership ceremony, or re-author the rule in its organization). A lean embedding with no organization object keeps sweeping the deployment: it has no organization to scope by.
- **Sharing-rule administration reads the caller's own organization only.** `listRules`, `getRule` (by id and by name), `evaluateRule` and `deleteRule` no longer reach an `organization_id = null` row for an organization-bound admin; system contexts and platform operators keep the unfiltered read. Deleting a "platform-global" rule no longer needs platform authority, because that rule class no longer exists: the guard is removed.
- **The approval unit screen is a strict equality.** A `department` approver resolves a `sys_business_unit` in the request's organization only (was: that organization or no organization). The ceremony attributes `sys_business_unit`, and a fresh install stamps it.
- **The scoped seed pre-load reads one thing: its organization's rows.** The second read that collected keys held by organization-less rows, and refused to twin or adopt them, is deleted; a scoped upsert/ignore/update issues no `organization_id IS NULL` read on any path.

Remedy for a database that still holds organization-less rows: `os migrate organization-ownership --out PLAN`, review it, then `os migrate organization-ownership --apply --plan-file PLAN --backup-taken`.
