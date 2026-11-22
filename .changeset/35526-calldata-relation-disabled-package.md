---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

fix(runtime)!: `callData`'s aggregate arm and no-protocol query fallback refuse a relation condition on a disabled package's object, the answer the data route already gives

Clause-②: no (narrowing: for a non-system caller, `callData`'s `aggregate` arm and its `query` fallback on a host with no protocol service refuse a nested-relation condition whose target belongs to a disabled package with 404 `OBJECT_PACKAGE_DISABLED`, where they answered the count or the matching rows)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is what the data route already answers for a relation condition on a disabled package's object. A caller that needs those records re-enables the package. -->

**BREAKING** for a non-system caller of `callData` on an environment that disables a package: the `/mcp` HTTP bridge's `aggregate_records` tool, and any host door that hands a caller's `where` to this function. A disable takes the package's records off the data plane: the data route answers its objects `404 OBJECT_PACKAGE_DISABLED`, and it refuses a nested-relation condition (`{ "lookup": { "field": VALUE } }`) on such an object the same way. `callData`'s `aggregate` arm never reaches the protocol, and on a host that registers no protocol service neither does its `query` fallback, so both still lowered the condition through the engine: a count came back 1 for the stored value and 0 for any other, a yes/no answer on a field of an object nobody may read.

- FROM: the condition was evaluated and the count (or the matching rows) returned.
- TO: the call is refused `404 OBJECT_PACKAGE_DISABLED`, naming the disabled object as `object` and the condition's position as `param` (for example `where.b_ref`), before the engine reads anything. The error is the data route's own.

The fix: re-enable the package to filter on its records again, or filter on the lookup's stored id. An environment with no disabled package sees no change. A system context (an in-process caller, such as a hook's `ctx.api`) is not changed: it is still answered the count.

`@objectstack/metadata-protocol` now exports `objectPackageDisabledError`, the one constructor of that refusal, so the runtime raises the same error instead of a copy. No behaviour of that package changes.
