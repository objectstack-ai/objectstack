---
'@object-ui/types': patch
---

refactor(types)!: delete nine Spec Report Bridge names nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#SpecReportChart, @object-ui/types#SpecReportChartInput, @object-ui/types#SpecReportChartSchema, @object-ui/types#SpecReportTypeEnum, @object-ui/types#SpecReportAggregate, @object-ui/types#QLAggregationFunction, @object-ui/types#mapAggregateToQL, @object-ui/types#JoinedSpecReport, @object-ui/types#isJoinedSpecReport) the retired operands are package re-exports of `@objectstack/spec/ui` symbols, two string unions, a helper function and a type guard that no renderer, adapter or host reads; nothing in the workspace or in hotcrm imports any of them from the package entry, they are not arms of `AnySchema`, and the spec schemas they re-exported stay where they are in `@objectstack/spec/ui`, so no stored shape, registered node type or conversion surface changes and there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these nine names from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They are **gone from the package, not only from the entry**: `src/spec-report.ts` no longer declares them. Two of them, `mapAggregateToQL` and `isJoinedSpecReport`, are runtime values, so the built `dist` loses them too. The rest of the Spec Report Bridge stays: `SpecReport`, `SpecReportInput`, `SpecReportTypeName`, `SpecReportDateGranularity`, `SpecReportSchema`, `LegacyReportPresentationLike`, `specReportToPresentation`, `isSpecReport` and `JoinedReportBlock`.

What leaves, and what to write instead:

- FROM `SpecReportChart` TO `ReportChartParsed` from `@objectstack/spec/ui`.
- FROM `SpecReportChartInput` TO `ReportChart` from `@objectstack/spec/ui`.
- FROM `SpecReportChartSchema` TO `ReportChartSchema` from `@objectstack/spec/ui`.
- FROM `SpecReportTypeEnum` TO `ReportType` from `@objectstack/spec/ui`.
- FROM `SpecReportAggregate`, `QLAggregationFunction`, `mapAggregateToQL` TO no replacement. A spec report is dataset-bound: its `values` name measures whose aggregation the dataset declares, so there is no per-column aggregate left to translate.
- FROM `JoinedSpecReport`, `isJoinedSpecReport` TO no replacement in this package. Test `isSpecReport(value) && value.type === 'joined'` and read `value.blocks`, each a `JoinedReportBlock`.
