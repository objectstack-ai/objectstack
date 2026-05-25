---
"@objectstack/plugin-auth": minor
---

WebContainer (StackBlitz) signup compatibility: `AuthManager` now auto-detects
WebContainer runtimes at construction time and swaps better-auth's default
`node:crypto.scrypt`-based password hasher for a pure-JS scrypt hasher built
directly on `@noble/hashes`.

**Why:** WebContainer's `node:crypto` polyfill ships an incomplete `scrypt`
implementation that throws `TypeError: y.run is not a function` on every
signup, blocking template demos on StackBlitz. We can't simply dynamic-import
`@better-auth/utils/password` because its `exports` map gates the pure-JS
build behind a non-`"node"` condition — Node-the-runtime (which WebContainer
reports itself as) always resolves to the `password.node.mjs` build. So we
reimplement the same scrypt hash directly with byte-identical params
(N=16384, r=16, p=1, dkLen=64) and the same `{saltHex}:{keyHex}` storage
format. Hashes produced by either implementation verify against the other —
no migration, no template changes.

**Scope:** detection short-circuits to `undefined` on real Node, so production
deployments are completely unaffected — `@noble/hashes` is only dynamically
imported when one of `process.versions.webcontainer`, `SHELL` containing
`jsh`, or `STACKBLITZ` env is present.

Templates (`@template/todo`, `@template/contracts`, …) require no changes;
the fix lives entirely inside `@objectstack/plugin-auth`.
