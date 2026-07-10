---
"@objectstack/spec": minor
"@objectstack/example-showcase": minor
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-security": patch
---

ADR-0090 permission-model zoo + docs alignment.

**Showcase (`@objectstack/example-showcase`)** now exercises the full Permission
Model v2 authoring surface and is guarded by a new runtime dogfood test
(`showcase-permission-zoo.dogfood.test.ts`): typed `definePosition`/
`definePermissionSet`/`defineSharingRule` factories; six flat positions (the
stale pre-D3 `parent` fields are gone); permission sets covering CRUD+FLS+RLS,
org-depth read/write asymmetry (`readScope: 'org'` / `writeScope: 'own'`),
View-All (auditor) and Modify-All (ops) bypasses, `systemPermissions`
(`setup.access`), the `isDefault` everyone-suggestion (incl. personal-data
grants on the `private`-OWD note object), a guest-safe set for the `guest`
anchor (D9), and a delegated-administration `adminScope` bounded to a seeded
`sys_business_unit` subtree (D12). Objects gain `externalSharingModel` dials
(D11). A committed `access-matrix.json` opts the showcase into the D6 snapshot
gate. Hierarchy depths (`own_and_reports`/`unit`/`unit_and_below`) are
deliberately NOT authored — they are enterprise (`hierarchy-security`) and the
open runtime fails closed; BU-shaped visibility is demonstrated via the
enforced `unit_and_subordinates` sharing-rule recipient instead.

**`@objectstack/spec`**: `defineStack` strict cross-reference validation no
longer rejects permission grants or seed datasets that target platform-provided
objects (`sys_`/`cloud_`/`ai_` prefixes) — a delegated-admin set carrying CRUD
on the RBAC link tables (ADR-0090 D12) and an app seeding the business-unit
tree are legitimate shapes; the typo net stays intact for the stack's own
objects. Stale pre-ADR-0090 vocabulary in zod docstrings (rls/territory/
sharing/tool/agent) is rewritten; the auto-generated references (including the
previously missing `security/explain.mdx`) are regenerated.

**Docs**: `protocol/objectql/security.mdx` rewritten to the v2 model (no
profiles, positions, canonical OWD four + D1 private default +
`externalSharingModel`, position-scoped RLS, enforced sharing recipients);
`isProfile` scrubbed from every authoring example; the dead
`/docs/references/identity/role` link fixed; implementation-status and
plugin READMEs aligned. Remaining rename misses are tracked in #2722
(RLSUserContext.role), #2723 (portal `profiles`), #2724 (sys_record_share
`role` enum).
