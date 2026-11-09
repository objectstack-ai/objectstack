---
'@objectstack/skills': patch
---

docs(skills): the objectui project-setup guide names where uploads live now that `@object-ui/providers` is gone

Clause-②: no
Metadata-protocol: none

- **Before.** `objectui/guides/project-setup.md` sent a third-party app to `@object-ui/providers` for `UploadProvider` / `useUpload`, in the provider-stack list and in the decision matrix. That package is retired and gets no further release.
- **Now.** `UploadProvider` / `useUpload` come from `@object-ui/fields`; the ObjectStack storage adapter `createObjectStackUploadAdapter` comes from `@object-ui/data-objectstack`; the `UploadAdapter` / `UploadOptions` / `UploadResult` contract is `@object-ui/types`'s, re-exported by `@object-ui/fields`.
- The troubleshooting section drops two monorepo-only tips (the Turbo cache block and the "downstream packages need built `dist/`" line), which a third-party app consuming published packages never needs.
- No schema, key or behaviour changes.
