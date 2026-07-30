---
'@objectstack/plugin-dev': minor
'@objectstack/plugin-hono-server': patch
---

Retire the three `security.*` dev stubs, and refuse to load `plugin-dev` under `NODE_ENV=production` (#4093).

**The security stubs are gone.** When `@objectstack/plugin-security` was not installed, `plugin-dev` filled its three slots with fakes that inverted the decision each stood in for: `security.permissions.checkObjectPermission()` returned `true` for everything, `security.rls.compileFilter()` returned `null` so no row-level predicate was applied, and `security.fieldMasker.maskResults()` returned rows unmasked. ADR-0076 D12's rule — learned from the analytics shim it retired in #3891 — is that a fallback may degrade features, **never security semantics**; `packages/spec/src/contracts/security-service.ts` says the same from the other side (these three are plugin-security's internals, and access-narrowing answers must fail CLOSED). Since `plugin-dev` loads SecurityPlugin through the same optional dynamic import as everything else, the package merely being absent was enough to swap real RBAC/RLS/masking for allow-all behind a single `warn` line.

The slots now stay empty — which is what production has without SecurityPlugin, and what every consumer already handles — and the boot log states plainly that RBAC, row-level security and field masking are not being enforced.

**`plugin-dev` now refuses to initialize under `NODE_ENV=production`.** It is a published package that registers development fakes for every unclaimed core service slot, including ones that report success for work they never did, and it had no environment check of its own: an `objectstack.config.ts` carrying `new DevPlugin()` into a production deploy got the whole fake slate with only a boot log to say so. `init()` now throws there. Set `OS_ALLOW_DEV_PLUGIN=1` if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

FROM → TO: a stack that relied on the dev security stubs was not being protected by them — it was being told everything was allowed. Install `@objectstack/plugin-security` to enforce RBAC/RLS/masking, or accept the empty slots (unchanged behaviour on every path that already handled an absent SecurityPlugin). A production process that loaded `plugin-dev` must now either drop it and install the real services, or opt in explicitly with `OS_ALLOW_DEV_PLUGIN=1`.

Also: `plugin-hono-server`'s `/auth/me/permissions` resolves `security.permissions` and `metadata` through the same guarded lookup its three sibling lookups already used. An unregistered slot makes `getService` throw, which previously landed in the outer catch — the same fail-open response body, but logged as "/auth/me/permissions failed" on every console navigation instead of taking the deliberate `!evaluator` branch.
