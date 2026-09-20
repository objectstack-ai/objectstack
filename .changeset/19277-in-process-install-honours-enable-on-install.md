---
"@objectstack/metadata-protocol": patch
---

The in-process install primitive honours `enableOnInstall` instead of ignoring it (#19277).

`InstallPackageRequestSchema.enableOnInstall` (`kernel/package-registry.zod.ts`) is the request contract of `ObjectStackProtocol.installPackage` / `MetadataProtocol.installPackage`. The implementation read `request.manifest` and `request.settings` and nothing else, so a caller that asked for `enableOnInstall: false` got an ENABLED install — no refusal, no warning, no effect. That is a declared option the runtime did not deliver, which ADR-0049 (enforce-or-remove) and Prime Directive #10 refuse outright. Ruling batch #153 item 5 letter 1 (#18605) kept this declaration as a COPY of the HTTP request key with the same meaning, so the disposition is enforce, not retire.

The primitive now applies the same rule the HTTP door applies (maintainer ruling batch #157 item 5 letter C, 「缺省 = 保持，有旗 = 设置」), through the same registry verbs `PATCH /packages/:id/enable` and `PATCH /packages/:id/disable` use:

```text
enableOnInstall: true    ⇒ enablePackage    — clears a disable, including a boot-seeded one
enableOnInstall: false   ⇒ disablePackage   — the row and its `status` both move
enableOnInstall absent   ⇒ no lifecycle call at all; the row the registry returned stands
```

Absent is a third state, not a synonym for `true`: on a FRESH id the registry still lands the package enabled (the declared default), and on an EXISTING row it preserves whatever that row says (#18877). A non-boolean value is read as absent rather than coerced.

⚠️ **What this seam does not write, stated rather than implied.** The runtime's durable disabled-package file is keyed by environment (`setPackageDisabled(environmentId, id, disabled)`, `@objectstack/runtime`), and an `InstallPackageRequest` carries no environment, so that record cannot be written from here — the HTTP door owns that half and writes it from the row it returned. `enableOnInstall` through the in-process primitive therefore moves the registry row, which is what every in-process reader serves from, for the life of the process; a caller that needs the choice replayed after a restart goes through the door that owns the durable record.

No behaviour changes for any caller on the tree: measured across `packages/**`, `examples/**` and `apps/**`, no existing call site sets the key — the HTTP door deliberately calls `installPackage({ manifest, settings })` and performs the flip itself, and `duplicatePackage` passes `{ manifest }` alone. The change is observable only to a caller that sets the key, which until now got silence.

Clause-②: no
