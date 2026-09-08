---
"@objectstack/driver-turso": minor
---

`TursoDriver.initObjects` now declares every key `SqlDriver.initObjects` declares — `tenancy`, `indexes` and `lifecycle` — so a caller of this package can spell them in a **fresh object literal** instead of hoisting the object to a variable to get past the type.

`TursoDriver` OVERRIDES `initObjects`, and an override does not inherit the base's parameter type. Its own literal read `Array<{ name: string; fields?: Record<string, any> }>`, which is what every consumer of `@objectstack/driver-turso` saw — so when #4311 declared `tenancy` on the base in August, that fix did not exist from outside this package, and stayed invisible for five weeks with nothing red anywhere. #16570's `indexes` fix would have escaped by the identical route.

The type face was the only thing refusing the keys. The remote arm forwards the whole object through as `schema`, and `registerRemoteFieldMetadata` reads `tenancy` straight back off it, so the runtime carried both keys the entire time. `tenancy.enabled: false` is the key that decides whether a UNIQUE partitions globally or per organization — an author who hit the refusal and dropped it silently got the other answer.

- `registerRemoteFieldMetadata(obj)` declares `tenancy?: any` and reads it directly; its `(obj as any).tenancy` cast is gone.
- The boundary is intact: a misspelling on a fresh literal is still `TS2353`, pinned in `src/turso-driver-16711-init-objects-param.test.ts`.
- `scripts/check-object-def-param-keys.mjs` now fails the build if this override — or any other subclass override in the workspace — declares fewer keys than the method it shadows, or erases the base's shape with an opaque type or an index signature.
