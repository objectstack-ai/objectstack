---
"@objectstack/runtime": minor
---

feat(runtime): extract the /meta and /data dispatcher domain bodies — ADR-0076 D11 step ③, PR-10, the terminal cut (#2462)

The last two domains leave the dispatcher: `domains/meta.ts` (metadata
read/write incl. ADR-0033 draft-aware protocol paths, ADR-0046 doc slimming
riding along with its exclusive `slimDocList` helper) and `domains/data.ts`
(CRUD/query over the action-execution `callData` bridge; the multi-tenant
unresolved-environment 428 now keys off a semantic `isMultiTenantHost()`
deps member instead of poking `kernelResolver`). **The dispatch() if-chain
is now EMPTY of domains** — 18 domains resolve through the registry, and
`createHonoApp`'s catch-all is ready for retirement (step ① of #2462).
Zero behavior change — runtime 649, http-conformance 41, dogfood 351 green.
