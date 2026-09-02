---
"@objectstack/spec": minor
---

feat(spec): retire `RestApiEndpoint.handlerStatus` and the Route Coverage Report shapes — declared, never read; the 501 they described comes from the endpoint executor (#13823, ADR-0049)

<!-- adr-0087: registered rest-api-endpoint-handler-status-retired -->

**BREAKING** accept-set narrowing and export removal, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`; the
prescription is registered under protocol major 18 —
`RETIRED_KEYS_BY_MAJOR[18]` for the key, `RETIRED_DEFS_BY_MAJOR[18]` for the
three defs, plus the D3 semantic entry
`rest-api-endpoint-handler-status-retired` — where `os migrate meta` users
will look). Maintainer ruling 2026-09-01 on #13823 (director decision batch
#27, verbatim 「同意」): remove; enforce excluded.

`handlerStatus` (`implemented` / `stub` / `planned`) was an authorable key on
`RestApiEndpointSchema` whose docstring promised that a `stub` handler
"returns 501 Not Implemented", and **nothing read it**. Measured at the
retirement base (`origin/main` a9b2be0b0, 2026-09-02, `skills/**` and tests
excluded): the only identifier hits were the declaration, its re-declaration
on `RouteCoverageEntrySchema` and a docblock saying adapters SHOULD warn on
it. The 501 it described has a different cause — every
`DispatcherErrorCode.enum.NOT_IMPLEMENTED` site (`runtime/src/endpoint-executor.ts`
×3, `runtime/src/api-mapping.ts`, `runtime/src/api-endpoint-step.ts`) is the
declarative-endpoint executor refusing a target or mapping it cannot serve,
and none consults the key. So an author who wrote `handlerStatus: 'stub'`
expecting a 501 got an ordinarily served route, and the declaration reported
progress to nobody: `RouteCoverageReportSchema`, the only shape that would
have carried it outward, had zero constructors in objectstack, objectui
(pinned sha) and cloud.

FROM → TO:

- `handlerStatus: 'implemented' | 'stub' | 'planned'` on a `RestApiEndpoint`
  → *(removed key)* — tombstoned with `retiredKey()` (the schema is not
  `.strict()`, so a bare deletion would be a silent strip): authoring it is
  now a `tsc` error and a parse error carrying the prescription at path
  `handlerStatus`, for every former value including the documented default
  `'implemented'` (prose only — the key never carried a Zod `.default()`, so
  no built artifact materialised it and there is no residue window).
- `HandlerStatusSchema` / `HandlerStatus` → *(removed — no replacement)*. The
  enum's only two carriers leave in this same change; an exported value
  schema with no consumer reads as a capability (#3950).
- `RouteCoverageEntrySchema` / `RouteCoverageEntry` and
  `RouteCoverageReportSchema` / `RouteCoverageReport` → *(removed — no
  replacement)*. No adapter, dispatcher or registrar ever constructed the
  report; it was a shape with no producer.

One-line fix: delete the key — nothing served changes, because nothing ever
read it. An endpoint that has no handler yet is simply not registered. Route
readiness that IS measured is untouched: the discovery payload's per-service
`status` / `handlerReady` (`api/discovery.zod.ts`) and the CI-asserted route
ledger (`packages/runtime/src/route-ledger.ts`). A declared-but-unbuilt route
answering 501 instead of 404 is a new capability the ruling explicitly
excluded (zero pull); if it is ever wanted it re-declares fresh under its own
ruling, executor first.

The retirement kit:

- key tombstone at the declaration (`api/RestApiEndpoint:handlerStatus` in
  `RETIRED_KEYS_BY_MAJOR[18]`; the surface baseline line carries `[RETIRED]`)
- whole-def deletions `api/HandlerStatus`, `api/RouteCoverageEntry`,
  `api/RouteCoverageReport` in `RETIRED_DEFS_BY_MAJOR[18]` (manifest keys
  deliberately removed; the #4725 gate adjudicated them)
- deliberately NO D2 conversion: nothing in the tree parses
  `RestApiEndpointSchema` outside its own unit tests — a REST API plugin route
  registration is not a stack collection member and never a `sys_metadata`
  row — so the conversion chain has no seam that would ever see one (the
  `kernel/Manifest:loading` disposition); the D3 semantic entry carries the
  prescription, and for the same reason the tombstone carries no
  `os migrate meta` sentence
- pin tests (`api/plugin-rest-api.handler-status-retirement.test.ts`): all
  three former values refused at path `handlerStatus` with the prescription,
  through the route-registration embed too; a well-formed endpoint without the
  key still parses and grows no `handlerStatus` property; the shipped default
  route registrations still parse; zero holders for all 6 retired export names
  on every public entry; the carrier schemas survive; the registrations under
  major 18 are present
- no liveness-ledger row moves: `RestApiEndpointSchema` is outside the walked
  population (not a registered metadata type and not in `SPEC_ONLY_SCHEMAS`),
  so the verdict is recorded here, in the schema and in the D3 entry
- teaching sweep: `content/docs/**`, `examples/**`, `packages/*/README.md` and
  `packages/create-objectstack/**` carry no hand-written mention; the generated
  reference page regenerates. The published skill `skills/objectstack-api`
  still teaches the key (governed surface — reported for the skills lane, not
  edited here)
