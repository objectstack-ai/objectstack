---
'@objectstack/mcp': patch
---

Connect an Agent is reachable from the Account app, so a non-admin can mint their own key

`POST /api/v1/keys` mints a `sys_api_key` bound to the **caller**, and the
Connect-an-Agent page says the key "acts as you". But the page's only navigation
entry sat in the Setup app, which declares `requiredPermissions:
['setup.access']` — so every non-admin following the shipped two-step guide, and
every reader of the runtime's own error text (`packages/mcp/src/plugin.ts`:
*"mint an API key (Setup → Connect an Agent, or POST /api/v1/keys)"*, and
`README.md`), stopped at step 1 while the endpoint behind the button had accepted
them all along. Measured before: a principal with no system permissions gets
`403 PERMISSION_DENIED` on `GET /api/v1/meta/apps/setup` and `nav_connect_agent`
is absent from the wire.

`CONNECT_AGENT_UI_BUNDLE` now carries a **second** `navigationContributions`
entry, targeting the `account` app's `grp_account_developer` group beside the
`nav_account_api_keys` entry already shipping there. Measured after, over the
real composition (real `SETUP_APP` / `ACCOUNT_APP` / `SETUP_NAV_CONTRIBUTIONS`,
the real fold and the real RBAC-by-route filter): the same permissionless
principal gets `200` on `GET /api/v1/meta/apps/account` with
`grp_account_developer` carrying `['nav_account_api_keys',
'nav_account_oauth_apps', 'nav_connect_agent']`, while `apps/setup` still
answers `403 PERMISSION_DENIED` with `connect_agent` absent from that body.

**Nothing else moves.** No backend change, no authorization change, no change to
which permissions exist, and the published "acts as you" promise is unchanged —
it simply becomes keepable for the users it was written for. The Setup entry
stays exactly as it was, so admins keep the page where the guide points, and no
gate is added or removed anywhere: a navigation contribution registers exactly
when the page registers, so an opted-out deployment
(`OS_MCP_SERVER_ENABLED=false`) still gets no page and neither entry.

⛔ Ungating Setup was **not** the fix, and was measured rather than assumed: the
app-level `setup.access` gate fires before the group gate, so dropping the group
gate alone changes nothing, and dropping both serves 14+ unrelated Setup
surfaces (Users, Organization, Business Units, Branding, Feature Flags, …) to
every signed-in user. ⛔ Nor was a `requiresService: 'mcp'` gate on an
`account.app.ts` entry: the `mcp` service registers unconditionally in `init()`
while this bundle registers behind `isMcpServerEnabled()`, so such an entry
would outlive its page and 404 for every signed-in user on an opted-out
deployment.

Both entries deliberately share the item id `nav_connect_agent` — one
destination, one identity. That is scoped, not a collision: `SchemaRegistry`
keys contributions by target app and `applyNavContributions(app)` consults only
that app's bucket, so a nav item id is unique within one app's navigation tree,
and the translation bundles are keyed `apps.<app>.navigation.<id>`.
