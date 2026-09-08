---
"@objectstack/driver-sql": minor
"@objectstack/driver-sqlite-wasm": minor
---

`SqlDriver.initObjects()` and `SqlDriver.registerObjectMetadata()` now declare the `indexes` key they have always read.

Both entry points took `Array<{ name; fields?; tenancy? }>`, with no `indexes` in the type. The key was read out of those very objects one call deep anyway, through an `as any`, in `registerManagedObjectMetadata` — and the map it fills, `managedObjectIndexes`, is what `syncDeclaredIndexes` renders every declared UNIQUE from. So the driver's whole index-sync path was driven by a key its own signature said did not exist, while the sibling `detectManagedDrift` on the same class had always declared `indexes?: any[]`: the two halves of one class disagreed about the shape of the same input.

That is the shape #4311 already addressed for `tenancy`, one key over, and the comment it left above `initObjects` described `indexes` word for word.

**Why nothing tripped over it.** TypeScript's excess-property check fires on a fresh object literal and not on one bound to a variable first, so the same object was accepted or rejected by nothing but where it was spelled — `await driver.initObjects([{ ...bare, indexes: [] }])` was rejected with TS2353, `const o = { ...bare, indexes: [] }; await driver.initObjects([o])` was accepted, and the index was synced either way. Every caller happened to bind first, so the package typechecked green for a reason unrelated to correctness.

**Why this matters beyond a compile error.** The loud symptom was a rejected correct call. The quiet one is the reachable branch: an author — or an AI — reading the signature concludes `indexes` is not accepted and drops the key, and a declared UNIQUE is then never synced, with no error at authoring time and no error at boot. The schema says those rows cannot collide; they can.

What changed, all inside `SqlDriver`:

- `registerObjectMetadata(objects)`, `initObjects(objects)` and the shared `registerManagedObjectMetadata(obj)` helper each gained `indexes?: any[]`, spelled exactly as `detectManagedDrift` already spells it.
- Every `(obj as any)` cast reading `indexes` off those parameters is gone — the one at the `managedObjectIndexes.set` site and the two inside `initObjects`' own create/alter path. The cast was the evidence that the declaration and the read disagreed; leaving any of them would have fixed the signature while keeping the "the type does not admit me but I read it anyway" path alive. That path is now closed on this parameter.

**What the accept set does, precisely — it moves in both directions.** For a **fresh object literal**, which is what an author writes and what the excess-property check judges, this is purely a widening: `{ ...bare, indexes: [...] }` was rejected and is now accepted. For a **variable-bound** argument, which bypasses that check and is judged by ordinary assignability, it is a narrowing: `indexes` spelled as a record, as a `readonly` tuple (`as const`), or as `null` compiled under the previous signatures and is now rejected with TS2322. Measured in both directions, all three shapes, on this package's own `tsc`.

That narrowing is deliberate and carries no migration. No caller in this repository is affected. Every shape newly rejected at compile time was already discarded at run time by the `Array.isArray(obj.indexes)` guard the driver has always applied — an author who wrote one of them got no index and no diagnostic, which is the exact failure this change exists to make impossible. And `any[]` is the spelling already published on `detectManagedDrift` for the same key on the same class, so an `as const` caller could not satisfy the sibling method either.

`@objectstack/driver-sqlite-wasm` is named because `SqliteWasmDriver extends SqlDriver` and overrides neither method, so both widened signatures land in its own published `.d.ts` and its consumers see the identical change. The two packages are in the same fixed version group, so this is a CHANGELOG effect rather than a version one.

The `IDataDriver` contract itself did not move: `registerObjectMetadata?(schemas: unknown[])` in `@objectstack/spec` already accepted `unknown[]`, and `SqlDriver` narrowed it on its own. What grew is `SqlDriver`'s own published accept set.
