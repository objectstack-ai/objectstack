---
'@objectstack/driver-memory': minor
---

`InMemoryDriver.update()` and `upsert()` publish their honest types. The emitted `.d.ts` read `Promise<any>` for both — the return type was inferred through the backing store's `any[]` rows, so the union collapsed and no caller was asked to narrow. They are now declared as the contract declares them: `update()` returns `Promise<Record<string, unknown> | null>` (the `null` arm is the non-`strictMode` miss the driver has always answered with), `upsert()` returns `Promise<Record<string, unknown>>`. No runtime behaviour changes.
