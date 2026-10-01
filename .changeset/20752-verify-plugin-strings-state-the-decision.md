---
'@objectstack/verify': patch
'@objectstack/plugin-dev': patch
'@objectstack/plugin-hono-server': patch
---

The `verify --rls` report and messages, the dev plugin's tenancy and no-auth messages and the Hono server's no-API warning no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Strings these three packages show to operators, and print in verification reports, sent the reader to an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/verify`, the `objectstack verify --rls` report: the header reads `=== objectstack verify (RLS / cross-owner by-id-write invariant) — <app> ===`, and the position-persona line reads `── position personas (each holds one declared position and nothing else) — N of M declared position(s) probed`.
- `@objectstack/verify`, an `rls-hole` verdict's detail: it says the by-id write bypassed RLS, and that a caller that cannot read a record must not be able to write it.
- `@objectstack/verify`, the refusal when the RLS probe persona cannot be provisioned (no ObjectQL engine): it says a by-id write that bypasses RLS is what becomes unreachable. The matching position-persona refusal drops its citation.
- `@objectstack/verify`, the records the probe writes: the probe permission set's row-level-security policy description, the probe `sys_permission_set` row's description and the position persona's `sys_user_position` reason drop their citations. Each already said what it is for.
- `@objectstack/verify`, the `bootStack` refusal for `multiTenant: true` when the app does not declare `@objectstack/organizations`: the citation beside "a package merely reachable through NODE_PATH or a hoisted workspace store is not accepted" goes.
- `@objectstack/plugin-dev`, the `REST API NOT enabled` warning for a stack that mounts no auth: it says anonymous access to object data is always denied, with no setting that turns that off.
- `@objectstack/plugin-dev`, the two refusals for an `OrganizationsPlugin` that refused to be constructed or failed to initialize: they drop their citations. Each already says `OS_ALLOW_DEGRADED_TENANCY` covers only an absent multi-org runtime, not a present one that declined.
- `@objectstack/plugin-hono-server`, the boot warning for a server with no data or discovery API mounted: it drops its citation. It already says the plugin is a transport adapter that serves neither.

Text only: no status, error code, exit code, route, field, export, verdict or count moves. A log filter or script that matched the old text (for example the report header's `RLS / #NNNN` spelling) needs the new spelling.
