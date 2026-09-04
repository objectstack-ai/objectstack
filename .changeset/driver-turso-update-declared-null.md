---
'@objectstack/driver-turso': minor
---

feat(driver-turso): the `update()` override publishes its honest type — `Record<string, unknown> | null`, not `any` (#14438)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention. `TursoDriver` overrides `update()` rather than inheriting it, and the override was written out with its own explicit `Promise<any>` — so this package's emitted `.d.ts` re-declared the door as `any` on its own and would not have picked up the `@objectstack/driver-sql` narrowing. Both of its branches already answered the contract's type: the local branch forwards to `SqlDriver.update()` (narrowed alongside, #14438) and the remote branch passes `RemoteTransport.update()`'s `Record<string, unknown> | null` (#14428) through the generic `formatRemoteRow`. The override now declares what it answers. A caller that read fields off the result through the `any` now narrows the `null` arm first. No runtime behaviour changes.

<!-- adr-0087: not-required (type-surface-only packages/drivers/driver-turso/src/turso-driver.ts#update) A published driver method's declared return moves off an explicit `any` onto the contract's own shape; no metadata key moves, `packages/spec` is untouched, and the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->
