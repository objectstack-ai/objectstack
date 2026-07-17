---
"@objectstack/plugin-auth": patch
---

Fix fresh-project auth returning 500 on every endpoint (sign-up / sign-in / get-session) with `Cannot set properties of undefined (setting 'modelName')`.

The published manifest declared `better-auth`, `@better-auth/core`, `@better-auth/oauth-provider`, and `@better-auth/sso` as `^1.6.23`, while only `@better-auth/scim` was pinned to `1.7.0-rc.1` (GHSA-j8v8-g9cx-5qf4 is fixed only in the 1.7.0 pre-release line). The framework workspace forces the whole better-auth family to `1.7.0-rc.1` via pnpm overrides, but overrides do not ship with published packages — a downstream `npx create-objectstack` install resolved the `^1.6.23` ranges to 1.6.23 (still the npm `latest`), and the resulting 1.7/1.6 mix crashes during better-auth initialization, so every fresh 15.1.0 project shipped with broken auth.

All four packages are now pinned to the exact `1.7.0-rc.1` — the only combination the workspace actually builds and tests against. The pins will be relaxed to `^1.7.0` once a stable better-auth 1.7.0 ships. A new CI gate (`scripts/check-override-consistency.mjs`) fails whenever a pnpm-workspace override target is not reachable from a publishable package's declared range, so tested-vs-published drift like this cannot recur silently.
