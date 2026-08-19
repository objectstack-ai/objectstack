---
"@objectstack/spec": patch
---

fix(spec): correct false "Aligned with CoreServiceName '…'" JSDoc claims across `packages/spec/src/contracts/*.ts` — `email-service.ts` now names the real `'email'` runtime slot registered by `@objectstack/plugin-email` (not a `CoreServiceName` member; subsumed under `'notification'`), and `export-service.ts` / `seed-loader-service.ts` now state plainly that they have no evidenced `CoreServiceName` slot or registration binding (`seed-loader-service.ts`'s companion "SeedLoaderProtocol in data/seed-loader.zod.ts" claim was also fabricated — no such export exists). The other 13 template instances were checked against `CoreServiceName` and left byte-identical; they are true. Comment-only; accept/reject behaviour is unchanged (#9752)
