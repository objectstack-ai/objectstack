---
'@objectstack/spec': patch
---

Fix four self-contained TSDoc `@example` blocks in `packages/spec/src` that did
not compile against the package's own built declarations, and add `os:check`
markers so `check:skill-examples` keeps them honest going forward.

The package's front-door header (`src/index.ts`) taught a root namespace-import
style (`import { Data, UI, System, Auth, AI, API } from '@objectstack/spec'`)
the root has never exported, and two subpath-import styles that named
`@objectstack/spec/auth` — a subpath that does not exist (the real one is
`@objectstack/spec/identity`). The header now documents three styles that
actually compile: root-level `defineX` factory imports (`defineStack`,
`defineView`, `defineApp`, `defineFlow`, `defineAgent`, `defineTool`,
`defineSkill`, …, which the root really does export), namespace imports via
subpath, and direct subpath imports — all against `@objectstack/spec/identity`
instead of the non-existent `/auth`.

`src/shared/branded-types.zod.ts`'s `@example` imported `ObjectNameSchema` /
`FieldNameSchema` from the package root; both are exported only from
`@objectstack/spec/shared`. Fixed the specifier.

No behavior change — TSDoc examples only.
