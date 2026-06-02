---
"@objectstack/plugin-auth": patch
"@objectstack/cli": patch
---

fix(dev): surface the seeded dev-admin credentials in the `serve` startup banner.

When the runtime seeds the dev admin on an empty DB, the confirmation was
emitted via `ctx.logger` during `runtime.start()` — inside serve's boot-quiet
window — so it was swallowed and never reached the console. plugin-auth now
records the seed result on the `auth` service and `serve` prints it in the
ready banner (after stdout is restored), e.g.:

```
  🔑  Dev admin: admin@objectos.ai / admin123
      seeded on empty DB · dev only — do not use in production
```

Shown only when an admin was actually seeded this boot (empty DB) — never on a
DB that already had a user, so stale credentials are never displayed. Visible
in both `serve --dev` and `os dev` (the child's stdout is inherited).
