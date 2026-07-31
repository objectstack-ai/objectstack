---
"@objectstack/spec": patch
"@objectstack/runtime": patch
---

fix(spec,runtime): the service-lookup `any` guard now sees the type-argument form, and its scope stops at nothing under `packages/` (#4251)

The #4127/#4214 rule banned `: any` and `as any` on a service-lookup result but
not `getService<any>('data')` — the form the codebase actually used (80 sites,
zero matches), erasing the slot contract identically. And the rule's `files`
covered only `packages/runtime`, leaving the composition roots (rest,
plugins/*, services/*) that hold most lookups unlinted. Both gaps closed: a
third AST selector catches the type-argument form, the scope is now all of
`packages/`, and the 40 not-yet-swept files are grandfathered in a visible,
shrinking ratchet list (`SLOT_LOOKUP_UNSWEPT`) — enumerated at 180 sites by
running the widened rule with the list emptied. `http.server` joins
`UNCONTRACTED_SLOTS` (three providers, no written contract).

Typing the three in-scope runtime sites surfaced its first yield: both
`addDatasource` datasource-registration branches (DefaultDatasourcePlugin,
DriverPlugin) probed a method **no metadata service implements**, so they had
never run on any boot — deleted rather than typed against a phantom shape. The
inert `DriverPluginOptions` they configured are tracked in #4320.
`registerInMemory('datasource', …)` is the actual visibility path (#3827).

Contract members declared from evidence, both optional: `IDataEngine` gains
`getDefaultDriverName?()` / `getDriverByName?()` (ObjectQL's driver registry —
the surface `os migrate` and serve's storage detection reach through
`driver.<name>` services), `IMetadataService` gains `registerInMemory?()`
(MetadataManager's boot-time seeding primitive). Callers that supplied `<any>`
to these lookups should pass the slot's contract type instead — or nothing:
an unmapped slot deliberately resolves to `unknown`, not `any`.
