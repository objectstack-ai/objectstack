---
'@objectstack/spec': patch
---

The doc comment on `InstallPackageRequestSchema`'s `enableOnInstall` key in `kernel/package-registry.zod.ts` no longer says `ManifestSchema` is declared in that file (it is declared in `kernel/manifest.zod.ts`), and its import-cycle reason now rests on the import that makes the cycle: `api/package-api.zod.ts`, which declares `PackageInstallRequestSchema`, imports `InstalledPackageSchema` from `kernel/package-registry.zod.ts` (#19748). Doc comment only; the directive against spelling `PackageInstallRequestSchema.shape.enableOnInstall` there is unchanged.
