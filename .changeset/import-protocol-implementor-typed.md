---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): let `ImportProtocolLike` type the admin import protocol's members (#17422)

`admin-import-users.ts` is the only hand-written in-repo implementor of the runner's `ImportProtocolLike`, and it annotated all three required members `args: any`. An explicit parameter annotation wins over the contextual type, so #16952's newly declared request dialect held every implementor except this one — the one with a demonstrated history: before #16950 this file read `args?.query?.$filter ?? {}`, the runner moved to the canonical spelling, the read went `undefined`, and the `?? {}` default degraded the import's duplicate probe into match-everything, so `POST /api/v1/auth/admin/import-users` updated the wrong users without a sound.

The three annotations are deleted, so `findData` / `createData` / `updateData` are typed by the contract they implement. Measured: with the annotations gone, reading a retired wire alias (`args.query?.$filter`) is `TS2339 Property '$filter' does not exist on type 'QueryInput'`; with `args: any` restored the identical probe type-checks at exit 0.

`FindDataRequest` declares `query` optional, so `findData` now states its refusal in code — a thrown `Error` carrying the already-registered `INVALID_REQUEST` code — instead of relying on an incidental `TypeError` from a property read on `undefined`. No `??` fallback and no optional chaining were added: both spell match-everything, which is the defect this closes.

No API, request body, response shape or exported signature changes. A caller that reaches `findData` through `runImport` always supplies `query`, so no supported call moves; only a protocol call that was already failing now fails with a code attached.
