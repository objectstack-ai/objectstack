---
"@objectstack/spec": patch
---

`liveness/README.md` — the `authorWarn` section's pointer to the lint that emits author warnings named a path that does not exist; it now names the module's real home, `packages/lint/src/lint-liveness-properties.ts` (#19269).

The ledgers and this README ship inside this package (`files[]` includes `liveness`), so the pointer an upgrading reader follows is this one. It read `packages/cli/src/utils/lint-liveness-properties.ts`, measured at zero in a full tree listing, while the module it describes — the one that reads these ledgers, emits the advisory warning and never fails the build — sits in `packages/lint/src/`. Nothing else moves: no schema, no export, no verdict, no ledger entry, no runtime behaviour.

- **This grid has no mechanical reader, which is why it rotted quietly.** `check:liveness` resolves the `evidence` paths inside ledger *entries*; a path written in README prose is checked by nobody, so the pointer stayed wrong through the move with every gate green. The lit control is the rule registration itself: `packages/lint/src/authoring-rules.ts` carries `source: 'packages/lint/src/lint-liveness-properties.ts'` as data, and that is the path this sentence now agrees with.
- **The second pointer in this file is deliberately left alone.** The closing paragraph of the type table says "see lint-liveness-properties.ts" — a bare filename with no directory. It is not stale (the basename resolves uniquely in the tree), and a bare filename carries no directory to rot; giving it one would newly expose it to exactly the failure this change repairs. The full path is stated once, here, where a reader who needs the directory gets it.
