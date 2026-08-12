---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): scope `getRule`'s by-id branch to the caller's organization (#7761)

**Cross-tenant security fix.** `SharingRuleService.getRule` resolved a rule id
with a bare `{id: idOrName}` predicate and no organization filter, executed
under the service's `SYSTEM_CTX` so nothing re-scoped it downstream. An
org-scoped sharing admin who held another organization's opaque `srule_…` id
could therefore reach that organization's rule through all three verbs that
resolve through `getRule`:

- `GET /api/v1/sharing/rules/:id` — read another tenant's rule, including its
  criteria, recipient and access level;
- `POST /api/v1/sharing/rules/:id/evaluate` — materialise that tenant's grants
  on demand;
- `DELETE /api/v1/sharing/rules/:id` — delete the rule **and purge every
  `sys_record_share` grant it had materialised**, silently revoking another
  tenant's record access.

The caller still needed `manage_sharing` (or the legacy
`manage_platform_settings`) in their own organization, but that is an
org-scoped capability — `scope: 'org'` in the spec's capability registry — and
a rule id is not a tenant boundary: ids leak through logs, exports, support
tickets, and the evaluate endpoint's own `{ruleId}` response.

The by-id lookup now carries the same tenant predicate the by-name path has
carried since #7676: `id = {id} AND (organization_id = {orgId} OR
organization_id IS NULL)` when the caller carries an organization. Two
behaviours are deliberately preserved: a no-org (system / boot) context still
resolves any row by id, so boot seeding, hooks and backfills are unaffected;
and a platform-global (`organization_id = null`) row stays reachable by id, for
symmetry with the by-name path.

Reaching another organization's rule by id is now indistinguishable from
addressing one that does not exist — `getRule` answers `null` (REST: 404),
`evaluateRule` throws `RULE_NOT_FOUND`, and `deleteRule` is a no-op that leaves
the row and its grants intact.
