---
'@objectstack/spec': minor
'@objectstack/plugin-security': patch
---

`IObjectQLEngine.getSchema` now returns `ServiceObject | undefined` instead of `unknown` (#12481) — the #11833 ruling's fork 3 as executed by #12248, applied one member over by inheritance: `ObjectQL.getObject` is literally `getSchema`'s alias (`return this.getSchema(name)`), the class has always answered `ServiceObject | undefined`, and `ServiceObject` lives in spec (`data/object.zod.ts`), so the contract's "engine-local type" rationale for `unknown` no longer applied here either. FROM `getSchema(objectName: string): unknown` TO `getSchema(objectName: string): ServiceObject | undefined` (authored state, ADR-0122, matching `getObject`). Consumers reading `managedBy` / `fields` / `userActions` off the answer no longer need a cast or a private structural re-declaration; `plugin-security`'s engine-owned write guard drops its now-redundant `as EngineOwnedSchemaLike | undefined` narrowing (behaviour unchanged). Implementations conforming to the class's actual behaviour are unaffected; a fake answering a non-conforming shape now fails compile at the member instead of drifting silently.
