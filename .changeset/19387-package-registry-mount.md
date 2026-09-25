---
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
---

fix(cli): `objectstack serve` mounts the always-on `package-registry` capability, so a package created through the API survives a restart on a stock boot (#19387)

Clause-②: no

`package-registry` has been on the always-on slate (`PLATFORM_ALWAYS_ON_CAPABILITIES`) since the `marketplace` / `package-registry` split, and `serve` appended it to every app's `requires`. But `Serve.CAPABILITY_PROVIDERS` did not key it, and the resolver's no-provider branch says nothing about a token the app did not declare itself. So an app that did not declare `requires: ['marketplace']` got no `package` service. `POST /api/v1/packages` answered `201`, printed `no 'package' service — '…' registered in-memory only (will not survive a restart)`, and `GET /api/v1/packages/:id` answered `404` after a restart.

- **`package-registry` now mounts `PackageServicePlugin`** from `@objectstack/service-package`, the provider the spec's `PLATFORM_CAPABILITY_PROVIDERS` row declares for it. A stock boot creates `sys_packages` and replays it at start, so installs and manifest edits made through the API persist.
- **Apps that declare `marketplace` boot as before, with one `PackageServicePlugin`.** `marketplace` resolves to the same provider. The capability resolver now remembers the providers it has mounted itself, so the always-on token does not mount a second copy. Without that change, a declarer's boot would print `Plugin superseded: 'package-service'`.
- **A stock database gains one table, `sys_packages`.** `PackageServicePlugin` creates it with raw DDL, as it already did for `marketplace` declarers. On the in-memory driver (`memory://`), which has no raw SQL, the boot now logs that the DDL was not run and that package hydration was skipped. Packages there last only as long as the process, as before.
- `--preset minimal` still opts out of the whole slate. `protocol.installPackage` keeps its in-memory-only branch as the documented degraded path for hosts that mount no provider.
- **`@objectstack/metadata-protocol`: the `installPackage` docblock no longer says the runtime half is missing.** It used to say that a stock boot still took the in-memory-only branch. It now says that `objectstack serve` mounts `PackageServicePlugin` for `package-registry`, so a stock boot persists, and that the in-memory-only branch is for hosts that mount no provider. The docblock ships in `dist`. No behaviour changes.
