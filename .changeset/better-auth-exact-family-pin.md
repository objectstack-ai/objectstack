---
"@objectstack/plugin-auth": patch
---

`@objectstack/plugin-auth` pins the `better-auth` family to an exact `1.7.2`, so a fresh install of a published `@objectstack/*` release loads the auth plugin again — and with it creates the system tables and seeds the admin.

Published 17.1.0, 17.2.0 and 17.3.0 declared `"@better-auth/core": "^1.7.2"` and imported `createLocalAccountIssuer` / `createOAuthAccountIssuer` from `@better-auth/core/db`. `@better-auth/core@1.7.3` — a **patch** — deleted both names, and the `account.issuer` column behind them, because upstream rolled the issuer-scoped account identity back to opt-in (better-auth/better-auth#10909). A static ESM named import of a missing export is a link-time `SyntaxError`, so the plugin could not load at all. Every symptom followed from that one failure and every one of them was quiet: the scaffolded project's CLI printed the `SyntaxError` as a scrollable oclif warning and carried on, the server printed `✓ Server is ready` on the broken boot, `sys_user` / `sys_organization` / `sys_permission_set` / `sys_position` were never created, the seeded admin sign-in never answered, and the Console's sign-in form answered `Auth request failed with status 404`.

**This is a stopgap, deliberately, and it is labelled as one.** Upstream removed the export on purpose; adopting 1.7.3 means dropping `sys_account.issuer` — a required column with a unique `(issuer, accountId)` index — from the platform object, retiring the boot-time backfill that stamps it, and migrating every existing deployment. That is its own change with its own decision to make; this one restores a working install today.

All five members `plugin-auth` declares move together (`better-auth`, `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/scim`, `@better-auth/sso`), because they are only correct as one line: `@better-auth/core@1.7.2` and `@better-auth/kysely-adapter@1.7.3` are mutually incompatible in both directions. `better-auth@1.7.2` declares its own siblings exactly, so pinning those five resolves all twelve family members to 1.7.2 — measured on a fresh `npm install` with no lockfile.

The workspace `overrides` move to the same exact target in step, so the version this repository tests is the version a consumer resolves. In-repo resolutions are unchanged: the lockfile already held 1.7.2 for all eleven overridden members.
