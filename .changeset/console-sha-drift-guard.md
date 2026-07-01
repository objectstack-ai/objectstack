---
"@objectstack/cli": patch
---

Guard against `@objectstack/console` version drift. The vendored Console SPA in `packages/console/dist` is a gitignored, locally-built artifact that only `scripts/build-console.sh` (`pnpm objectui:build` / `objectui:refresh` / `release` / CI) produces — `turbo run build` never rebuilds it. Pulling a branch that bumps the committed `.objectui-sha` pin therefore left a stale dist in place, and the CLI would silently serve a Console built from a different objectui commit (the npm-major version guard can't see a SHA move under one package version).

`build-console.sh` now stamps the built objectui SHA into `dist/.objectui-sha`. A new `pnpm check:console-sha` compares that stamp against the pin and fails loudly on drift (hard-gating `pnpm dev` / `dev:crm` / `dev:todo`), and `resolveConsolePath` warns at serve time when it selects a drifted dist. Remediation is `pnpm objectui:build` (rebuild at the pinned SHA). Published installs ship no pin, so their stamped dist stays authoritative and the guard is a no-op.
