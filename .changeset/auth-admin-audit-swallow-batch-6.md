---
'@objectstack/plugin-auth': minor
---

Report the refused admin-audit writes two `catch { }` sites swallowed (#12981 batch 6)

The two tier-1 DARK durability swallows on `plugin-auth`'s admin surface: an
administrative action landed, its audit row was refused, and the endpoint
answered `200` with nothing written anywhere. Control flow is unchanged at both
sites — an admin operation must never fail over its own audit — but the refusal
is no longer silent.

Both `catch` blocks were doing two jobs and were only right about one of them:

- **plugin-audit UNINSTALLED** — there is no `sys_audit_log` object at all, so
  nothing ever claimed the action would be audited. Silence is correct, and
  reporting here would put a line on every admin action in every deployment that
  does not run plugin-audit.
- **plugin-audit INSTALLED, the write REFUSED** — the action happened, the audit
  record did not, and nothing retries or reconstructs it.

Both spelled `catch { }`. Each site now asks `getSchema('sys_audit_log')` — the
registry that owns the answer — instead of reading the driver's error text,
which would decide the same question by guessing. `getSchema` is declared
**optional** on `AdminUserDataEngine` and `IdentityImportEngine`, so it is
additive and no host that type-checks today stops doing so; where it is absent
the site cannot measure the difference and therefore reports, because an
unmeasurable write must not be a silent one.

What was hiding in the silence:

- `admin-user-endpoints.ts :: writeAdminAudit` — `sys_account` is in
  plugin-audit's `SKIP_OBJECTS`, so for `/admin/set-user-password` its generic
  writer emits **zero** rows and the row refused here was the only record that a
  password was ever administratively reset.
- `admin-import-users.ts` run-level row — `action: 'import'` with a null
  `record_id` is a shape plugin-audit's `actionFor` structurally cannot emit. The
  per-row `create` rows still land, which is what made this dangerous: the trail
  looked complete while who ran the import, under which password policy, and what
  it did in aggregate was gone.

Both sinks (`AdminUserEndpointDeps.logger`, `IdentityImportDeps.logger`) are
`{ warn(msg: string): void }` and both are re-exported from the package
`index.ts`. Neither declares `error`, so the LEVEL stays `warn` and remains
#13398's question; only the SILENCE is repaired here. Each seam is pinned by a
test that fails if it goes quiet again, plus absence-asserting cases so a seam
that warns unconditionally cannot pass.
