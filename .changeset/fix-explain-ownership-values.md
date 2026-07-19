---
"@objectstack/cli": patch
---

fix(cli): `os explain object` documented `ownership` with the wrong allowed values (#3244)

The schema catalog described the object `ownership` field as the package
*contribution* kind (`"own" | "extend"`, the `ObjectOwnershipEnum` set via
`registerObject`). But `ObjectSchema.ownership` is the **record-ownership
model** — `z.enum(['user', 'org', 'none'])` — a distinct concept the spec
explicitly warns not to conflate despite the shared word.

`os explain object` now prints:

    ownership   'user' | 'org' | 'none'   Record-ownership model: user (default,
    injects a reassignable owner_id) | org | none (no per-record owner).
    Distinct from the package own/extend contribution kind.

A regression test (`packages/cli/test/commands.test.ts`) pins the documented
values to the record-ownership enum so the two concepts can't drift back
together. Found during the #1880 docs implementation-accuracy audit.
