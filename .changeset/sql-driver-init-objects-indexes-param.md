---
"@objectstack/driver-sql": patch
---

`SqlDriver.initObjects()` and `SqlDriver.registerObjectMetadata()` now declare the `indexes` key they have always read.

Both entry points took `Array<{ name; fields?; tenancy? }>`, with no `indexes` in the type. The key was read out of those very objects one call deep anyway, through an `as any`, in `registerManagedObjectMetadata` — and the map it fills, `managedObjectIndexes`, is what `syncDeclaredIndexes` renders every declared UNIQUE from. So the driver's whole index-sync path was driven by a key its own signature said did not exist, while the sibling `detectManagedDrift` on the same class had always declared `indexes?: any[]`: the two halves of one class disagreed about the shape of the same input.

That is the shape #4311 already fixed for `tenancy`, one key over, and the comment #4311 left above `initObjects` described `indexes` word for word.

**Why nothing tripped over it.** TypeScript's excess-property check fires on a fresh object literal and not on one bound to a variable first, so the same object was accepted or rejected by nothing but where it was spelled — `await driver.initObjects([{ ...bare, indexes: [] }])` was rejected with TS2353, `const o = { ...bare, indexes: [] }; await driver.initObjects([o])` was accepted, and the index was synced either way. Every caller happened to bind first, so the package typechecked green for a reason unrelated to correctness.

**Why this matters beyond a compile error.** The loud symptom was a rejected correct call. The quiet one is the reachable branch: an author — or an AI — reading the signature concludes `indexes` is not accepted and drops the key, and a declared UNIQUE is then never synced, with no error at authoring time and no error at boot. The schema says those rows cannot collide; they can.

What changed, all inside `SqlDriver`:

- `registerObjectMetadata(objects)`, `initObjects(objects)` and the shared `registerManagedObjectMetadata(obj)` helper each gained `indexes?: any[]`, spelled exactly as `detectManagedDrift` already spells it.
- The `(obj as any)` cast at the `managedObjectIndexes.set` read site is gone. The cast was the evidence that the declaration and the read disagreed; leaving it would have fixed the signature while keeping the "the type does not admit me but I read it anyway" path alive.

This relaxes a driver-local narrowing back toward the contract it implements — `IDataDriver.registerObjectMetadata?(schemas: unknown[])` in `@objectstack/spec` accepts `unknown[]`, and `SqlDriver` narrowed it on its own — so it is not a widening of the protocol. No call that compiles today stops compiling: the parameter type only gained an optional key.
