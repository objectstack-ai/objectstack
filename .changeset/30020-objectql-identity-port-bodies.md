---
'@objectstack/objectql': patch
---

refactor(objectql): eight `ObjectQL` bodies that hand the engine on move into their facets

Clause-②: no
Metadata-protocol: none

- The bodies of `bindHooks`, `createContext`, `buildHookApi`, `resolveReadableIdsSecurity`, `ownershipQueueService`, `readMigrationFlagRowMemoized` and `recomputeSummaries` move out of `engine.ts` into the facet module of their section, and the `formulaReadsReference` slot of `serveReferenceNames`' host moves into `engine-reference-name-visible.ts`. Each method stays on the class as a one-call stub with its signature, and a public method keeps its docblock there. A body that handed the engine itself on (`bindHooksToEngine(this, …)`, `new ScopedContext(ctx, this)`, a symbol slot read off the engine) reads the same engine through its host's `facade` entry.
- No behaviour changes and nothing to do on upgrade. The built declaration files keep every member and every public or protected docblock; the five private methods' docblocks moved with their bodies, so they no longer appear in the shared declaration chunk, and the source maps move.
