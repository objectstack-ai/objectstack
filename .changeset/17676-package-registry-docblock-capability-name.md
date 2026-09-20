---
"@objectstack/metadata-protocol": patch
---

`installPackage`'s docblock no longer names `marketplace` as the capability that governs package persistence — after #17676 ruling A′ item 1 that half is `package-registry`, and `marketplace` names only the optional catalogue (#17676).

Clause-②: no

The shipped note read *"when the `package` service is absent (e.g. the `marketplace` capability is off)"*. That parenthetical was accurate when it was written and stopped being accurate when the carve-out landed: `packages/spec/src/kernel/platform-capabilities.ts` now carries `marketplace` and `package-registry` as two tokens, with the `sys_packages` container and its boot hydration under the second — a core capability mounted always — and browsing left under the first. A consumer reading this docblock in an editor, out of `dist/index.d.ts`, was being pointed at the wrong switch.

- **⛔ No behaviour moves, and this is not the card's defect being repaired.** The in-memory-only branches in `installPackage` and `updatePackage` are byte-identical. Ruling A′ item 2 keeps them deliberately, as the documented degraded path for reduced hosts — a host that mounts no provider must still be able to install a package for the life of its process — so the note now says that too, rather than leaving the branch reading like an oversight. #17676 stays open.
- **The note also records what is NOT true yet, measured rather than assumed.** `Serve.CAPABILITY_PROVIDERS` (`packages/cli/src/commands/serve.ts`) keys `marketplace` and does not key `package-registry`, so the always-on token is force-appended to every app's `requires` and then resolves to no provider — silently, because the resolver warns only for tokens outside the vocabulary. A stock boot still takes the absent-service branch. That half of the ruling belongs to the capability resolver and is not in this package.
- `updatePackage`'s docblock points at the same note, since the ruling names both primitives.

Published surface: doc comments only. `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` and `dist/index.d.cts` all carry the corrected text — tsup keeps JSDoc, which is why this ships at all — and no export, type, signature or runtime string moves.
