---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: in multi-org mode `POST /api/v1/auth/admin/import-users` joins each row's user to the importing administrator's current organization, under create-user's rule

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are refusals of an admin HTTP request in multi-org mode: no stored row, layer, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an administrator importing users under a walled posture (`group` / `isolated`, `features.multiOrgEnabled`). Single-org deployments, and a degraded wall, do not move. The import now follows create-user's rule (ADR-0093 D3 amendment): every row's user joins the administrator's current organization as `member`, in the same unit of work as its account. Four answers move:

- FROM: an administrator with no current organization got `200` and every row's user was created, in no organization. TO: the whole import is refused `400 NO_ACTIVE_ORGANIZATION` (create-user's code and sentence) and no user is created. A `dryRun` is refused the same way.
- FROM: a server that cannot run the join inside the account's unit of work (no unit of work wired, or better-auth's organization plugin off) imported every row. TO: the whole import is refused `501 NOT_IMPLEMENTED`, as create-user is, and no user is created.
- FROM: a row whose organization would refuse the member (its membership limit) was created anyway, in no organization. TO: that row fails with the refusal's code (for example `ORGANIZATION_MEMBERSHIP_LIMIT_REACHED`), its account is rolled back, and it gets no temporary password and no invitation. The other rows still land.
- FROM: on `mode: 'upsert'`, a row matching an existing user updated its profile and touched no membership. TO: the matched user joins the current organization too, and a refused join fails the row with its profile update rolled back. A user already in the organization is not added twice.

The fix for a caller: switch to the organization the people belong to before importing them. A row refused for the membership limit imports once the limit is raised (`OS_ORG_MEMBERSHIP_LIMIT`).

Because the imported users are now members of the current organization, a `positions` column on a multi-org import is judged against that organization's membership and assigns, where it was refused on every row before.
