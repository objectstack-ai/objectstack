---
"@objectstack/spec": minor
---

`IDataDriver` now declares `aggregate?` — the one engine-reached driver verb that had no signature to match against.

The engine has always dispatched native aggregation by presence (`typeof driver.aggregate === 'function'`) and called `driver.aggregate(object, query, options)`, but the interface never spelled the member, so a custom driver's `aggregate` was checked in neither direction: swapped arguments or a non-row result compiled clean and surfaced only after the engine's `having` filter silently matched nothing. The member is declared optional, matching the presence test — a driver without native aggregation omits it and stays conformant, served by the `find()` + in-memory fallback.

Additive: every in-repo driver already satisfies the declared signature (`(object: string, query: DriverQuery, options?: DriverOptions) => Promise<Record<string, unknown>[]>`); a wider parameter union or a looser return type stays assignable. What is newly refused is a wrong argument order or a non-array result. No `DriverCapabilities` bit is added — presence remains the capability test, as `data/driver.zod.ts` rules.
