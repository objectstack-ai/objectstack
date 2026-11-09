---
'@objectstack/objectql': patch
---

refactor(objectql): `ScopedContext`'s two bodies that hand the instance on move into its facet

Clause-②: no
Metadata-protocol: none

- The bodies of `ScopedContext#transaction` and of its symbol-keyed grants seeding step (the one a hook's `runAs: 'user'` api awaits) move out of `engine.ts` into `engine-scoped-context.ts`. Each method stays on the class as a one-call stub with its signature and docblock. Where a body handed the context itself on (`return this`, `callback(this, …)`), it reads the same instance through its host's `facade` entry.
- No behaviour changes and nothing to do on upgrade. The built declaration files keep every member and every docblock; the source maps move.
