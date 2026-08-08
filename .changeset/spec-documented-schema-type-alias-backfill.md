---
"@objectstack/spec": minor
---

feat(spec): 73 documented schemas gain the `export type` alias their reference page was silently dropping (#4593)

Every generated page under `content/docs/references/` opens with a "TypeScript
Usage" block that spells two imports — the schema const and the type alias. Since
#4570 the generator resolves both names against the package's real export surface
and **omits** anything that would not compile, so the docs have never advertised a
dead import. The omission was countable rather than silent
(`docs-import-surface.baseline.json`), and it was large: 136 documented JSON
Schemas published a schema const with no type alias carrying the same name, so
their pages showed the value import and no `import type` line at all. That is the
line an AI metadata author copies.

This backfills 73 of them. Each gets the ADR-0122 house shape — the bare name is
the AUTHOR state:

```ts
export const FileValueSchema = lazySchema(() => z.looseObject({ ... }));
export type FileValue = z.input<typeof FileValueSchema>;
```

Purely additive at the type level: 51 brand-new names, and 22 where the schema was
already exported under its own bare name (`export const OWDModel = z.enum([...])`)
so the alias merges with the existing const — `api-surface/` records those as
`(type)` instead of `(const)`, which is the shape the package's 84 pre-existing
const/type merges already have. No schema, `.describe()`, default or runtime
behaviour moved; no consumer changed.

By family: 22 closed enums and enum-like vocabularies (`ApproverType`,
`AggregationFunction`, `DimensionType`, `SharingLevel`, `ReportType`,
`ActionType`, `MetadataState`, …), 20 request/props shapes (three
`DataEngine*Request`, `ElementNumberProps`, `ElementRecordPickerProps`,
`RecordPathProps`, `MetadataValidateRequest`, `GetAnalyticsMetaRequest`, …), 9
`data/` field-value shapes (`FileValue`, `LocationValue`, `InstantValue`,
`AddressValue`, …), 7 `ui/view` configs (`KanbanConfig`, `GanttConfig`,
`CalendarConfig`, `TreeConfig`, …), and 15 others across `system/`,
`integration/`, `qa/`, `studio/`, `automation/`.

Two entry points also re-export a name they were already publishing the schema
for, so the type reaches the same subpath as its page: `ConnectorInstanceNoAuth`
/ `Bearer` / `APIKey` / `BasicAuth` on `@objectstack/spec/integration`, and
`PanelLocation` on `@objectstack/spec/studio`.

The ratchet shrinks 136 → 63. What stays, and why — the remainder is not a
backlog of identical work:

- **17 already have the alias under a different name.** `Discovery` is published
  as `DiscoveryResponse`, `SortDirectionEnum` as `SortDirection`, `Index` as
  `ObjectIndex`. Declaring the docs-derived name as well would mint exactly the
  permanent synonym ADR-0122 D3 forbids — a name an author can only pick wrongly
  — so the honest fix is a rename or a doc-name change, not a second alias.
- **40 are not isomorphic**: `z.input` differs from `z.infer`, so under
  ADR-0122 the bare alias needs an `XParsed` sibling rather than a pin. Whether
  those 40 `XParsed` names should be published is a separate call.
- **5** sit in files under concurrent edit and were deferred rather than raced.
- **1**, `system/ServiceStatus`, cannot take the name at all: `@objectstack/spec/api`
  already exports a *different* `ServiceStatus` (the discovery health enum), so
  the alias would create the cross-entry-point ambiguity
  `check:dual-source-exports` exists to keep at zero. One of the two names is
  wrong; picking which is a rename decision.

Isomorphism was measured, not assumed: a probe asserting
`Eq< z.input, z.infer >` over all 114 non-synonym candidates, compiled by tsc.
The 73 that came back true are pinned in
`packages/spec/src/type-alias-convention.pin.test.ts` (748 → 821), where tsc
re-proves each one on every run and goes red the day a nested `.default()` gives
one of them a second shape.
