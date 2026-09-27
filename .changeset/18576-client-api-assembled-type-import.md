---
'@objectstack/client': patch
---

fix(client): take `InstalledPackageAtEitherStage` from `@objectstack/spec/api-assembled` (#18576)

`@objectstack/spec` moved the declarations that embed the assembled package body — `InstalledPackageAtEitherStage` among them — off `@objectstack/spec/api` into the new `@objectstack/spec/api-assembled` entry. The client's `packages.list` / `packages.get` return types (and their scoped twins) name that type, so the published declarations now import it from the new entry. The return types are the same type as before; nothing a caller writes changes. It is a type-only import, erased from the client's bundle.
