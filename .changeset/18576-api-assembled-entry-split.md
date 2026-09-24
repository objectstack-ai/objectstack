---
'@objectstack/spec': minor
---

feat(spec)!: split the assembled-stage package API declarations off `@objectstack/spec/api` into the new `@objectstack/spec/api-assembled` entry (#18576)

**BREAKING** — five Package API declarations, with their types, are no longer exported from `@objectstack/spec/api`. They are exported, unchanged, from the new entry `@objectstack/spec/api-assembled`.

A `major`-class change — an existing import path stops resolving for these names — recorded as `minor` under the launch-window convention. Maintainer ruling on #18576, batch #145 item 1, letter B, 「同意,其他也同意」.

**Why.** These five declarations embed the ASSEMBLED package body, which reaches the whole metadata vocabulary and, behind it, the datasource declaration and the driver-config validators. While they were declared inside `@objectstack/spec/api`, that tree was part of every bundle of the entry, and the entry ships as one self-contained bundle that a consumer's tree-shaking can recover little of. A browser module that imports two string constants from `@objectstack/spec/api` paid for all of it. Measured on the splitting PR (esbuild 0.28.2, `platform: browser`, conditions `browser` + `import`, minified, gzip -9), for objectui's `@object-ui/core` `column-sortability.ts`, which imports only those two constants: **311,124 → 166,529 bytes gzipped (−46.5%)**. The `./api` entry bundle itself goes from 612,813 to 469,795 bytes gzipped, and its module graph no longer reaches `stack.zod`, the datasource declaration or any driver-config module. `./api` also no longer needs a `browser` export condition, since nothing in its graph links the server-only pg URL grammar any more; the condition moves to `./api-assembled`.

### FROM → TO

| removed from `@objectstack/spec/api` | import instead from |
| --- | --- |
| `AssembledInstalledPackageSchema`, `AssembledInstalledPackage`, `AssembledInstalledPackageParsed` | `@objectstack/spec/api-assembled` |
| `InstalledPackageAtEitherStageSchema`, `InstalledPackageAtEitherStage`, `InstalledPackageAtEitherStageParsed` | `@objectstack/spec/api-assembled` |
| `ListInstalledPackagesResponseSchema`, `ListInstalledPackagesResponse`, `ListInstalledPackagesResponseParsed` | `@objectstack/spec/api-assembled` |
| `GetInstalledPackageResponseSchema`, `GetInstalledPackageResponse`, `GetInstalledPackageResponseParsed` | `@objectstack/spec/api-assembled` |
| `PackageApiContracts` | `@objectstack/spec/api-assembled` |

**The one-line fix: change the import path.**

```ts
// before
import { ListInstalledPackagesResponseSchema } from '@objectstack/spec/api';
// after
import { ListInstalledPackagesResponseSchema } from '@objectstack/spec/api-assembled';
```

The compiler finds every site: `TS2305` ("Module '"@objectstack/spec/api"' has no exported member …"), or `TS2724` with a did-you-mean when a similarly named export exists — measured on the splitting PR, `ListInstalledPackagesResponseSchema` from `/api` answers `TS2724 … Did you mean 'InstallPackageResponseSchema'?`, which is NOT the name you want. Nothing else changes: every schema parses and refuses exactly what it did, `PackageApiContracts` keeps its four entries, and the JSON Schema ids are the same (`json-schema/api/AssembledInstalledPackage.json` and its three siblings are still published under `api/`, and still documented in the API reference). Every other Package API declaration — the two read doors' request schemas, the install / uninstall / upgrade / rollback shapes and `PackageApiErrorCode` — stays on `@objectstack/spec/api`. If you only use those, or any other `/api` contract, you need to do nothing.

⚠️ **Out-of-repo consumers are NOT MEASURED beyond objectui.** Inside this repository the moved names had four importers (the client's type import, one runtime conformance test, the client's return-type pins and the spec's own unit test), all moved in the same PR. objectui at the pinned `.objectui-sha` imports none of the moved names from anywhere; its six browser-shipped files that import `@objectstack/spec/api` keep resolving every name they use, from `/api` itself. `@object-ui/types` re-exports `@objectstack/spec/api` as a type-only `API` namespace, which loses the moved names with this release; objectui itself references none of them through it. The `cloud` repository was not measured.

The ADR-0087 D3 semantic entry `api-assembled-entry-split` carries the judgement: an import path is TypeScript source, not metadata, so there is no source a D2 conversion could rewrite.

Clause-②: yes

<!-- adr-0087: registered api-assembled-entry-split -->
