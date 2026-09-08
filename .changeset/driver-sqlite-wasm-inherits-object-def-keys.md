---
"@objectstack/driver-sqlite-wasm": minor
---

`SqliteWasmDriver.initObjects` accepts `tenancy`, `indexes` and `lifecycle` in a **fresh object literal**, inherited from the widened `SqlDriver` — and that inheritance is now asserted rather than assumed.

This package overrides neither `initObjects` nor `registerObjectMetadata`, so its published `.d.ts` re-declares none of them and the door it exposes is `SqlDriver`'s, imported from `@objectstack/driver-sql`. Measured on the built declarations: zero re-declarations of `initObjects`, `registerObjectMetadata`, `rotateShards`, `ensureShardTable` or `registerManagedObjectMetadata`. That is the opposite direction of the defect the sibling packages carried — `TursoDriver` overrode `initObjects` with a narrower literal and shadowed a base-class fix for five weeks — and it is recorded here because a consumer reading only this package's changelog would otherwise never learn its accept set moved.

`src/sqlite-wasm-16711-inherited-object-def-keys.test.ts` pins the inheritance inside this package's own tsc program: the inherited parameter is not `any`, each key is present on the element type, a fresh literal carrying them compiles and is read at run time, and a misspelling is still `TS2353`. It goes red both ways — if the base narrows again, and if a future override here re-declares the door more narrowly.
