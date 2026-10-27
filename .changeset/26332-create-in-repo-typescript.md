---
'@objectstack/cli': patch
---

fix(cli): an `os create plugin NAME --in-repo` scaffold passes its own `typecheck` and `build`

Clause-②: no
Metadata-protocol: none

- **Before.** The in-repo plugin declared `typescript` as the standalone scaffold range (`^5.3.0`, installed as 5.9.3). It extends `tsconfig.base.json`, whose `ignoreDeprecations: "6.0"` only TypeScript 6 accepts, so `tsc` stopped with TS5103. With the workspace's TypeScript 6 it then stopped on the starter `init(context)` with TS6133, under the base's `noUnusedParameters`.
- **After.** The in-repo placement declares the workspace's TypeScript (`^6.0.3`, the range the repository root and every sibling plugin declare). The starter's `init` parameter is `_context`, with a comment saying what it is for. A fresh in-repo scaffold's `typecheck` and `build` both exit 0.
- The standalone (default) placement still declares `^5.3.0`, the documented TypeScript floor. Its starter `src/index.ts` takes the same `_context` rename, since both placements share one starter.

What to do: nothing for new scaffolds. An in-repo plugin scaffolded earlier: set its `devDependencies.typescript` to `^6.0.3`, and rename `init(context)` to `init(_context)` unless `init` reads it.
