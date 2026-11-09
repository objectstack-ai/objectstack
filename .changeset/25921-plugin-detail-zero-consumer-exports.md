---
'@object-ui/plugin-detail': patch
---

refactor(plugin-detail)!: retire twenty-one zero-consumer exports (record-page synthesis, layout, related-card and timeline helpers, one hook and three types)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-detail#queueClaimAdmitted, @object-ui/plugin-detail#extractLookupId, @object-ui/plugin-detail#TEXTUAL_REF_FALLBACK_TYPES, @object-ui/plugin-detail#inferDetailColumns, @object-ui/plugin-detail#applyAutoSpan, @object-ui/plugin-detail#applyDetailAutoLayout, @object-ui/plugin-detail#DetailTabsProps, @object-ui/plugin-detail#buildDefaultDiscussion, @object-ui/plugin-detail#buildDefaultTimeline, @object-ui/plugin-detail#deriveStages, @object-ui/plugin-detail#RECORD_PAGE_WIDE_MIN_WIDTH, @object-ui/plugin-detail#recordPageColumnOfTab, @object-ui/plugin-detail#RecordPageColumn, @object-ui/plugin-detail#useDefaultRecordPage, @object-ui/plugin-detail#relatedCountTargetOf, @object-ui/plugin-detail#filterTimelineStream, @object-ui/plugin-detail#RELATED_CARD_NEW_BADGE_MS, @object-ui/plugin-detail#editRelatedArrangement, @object-ui/plugin-detail#relatedCardId, @object-ui/plugin-detail#relatedDefaultOrderHash, @object-ui/plugin-detail#RelatedArrangementEdit) the retired operands are pure helpers of the synthesized record page, its layout and its related cards, one React context hook, and three TypeScript types; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these twenty-one names from `@object-ui/plugin-detail`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package and keeps its in-package readers (the record page synthesizer, `DetailView`, `RecordPageColumns`, the related cards and the timeline stream); only the entry stops publishing them. Everything else on the entry, including `buildDefaultPageSchema`, `buildDefaultTabs`, `isWideFieldType`, `InlineFieldInput`, `recordSitsInQueue`, `DefaultRecordPageContext`, `prefetchRelatedCounts`, `relatedCountTargetsIn`, `mergeTimelineStream`, `resolveRelatedArrangement` and the `RelatedArrangement` / `RecordPageTier` / `DefaultPageColumns` types, stays exported unchanged.

What leaves, and what to write instead:

- FROM `buildDefaultDiscussion`, `buildDefaultTimeline`, `deriveStages` TO `buildDefaultPageSchema`, which builds the whole default record page including its discussion, timeline and stage path.
- FROM `RECORD_PAGE_WIDE_MIN_WIDTH`, `recordPageColumnOfTab`, `RecordPageColumn` TO `recordPageTierFor` and `buildDefaultPageColumns`, which place the page's tabs into columns for a width.
- FROM `inferDetailColumns`, `applyAutoSpan`, `applyDetailAutoLayout` TO `DetailView`, which lays out its sections itself; `isWideFieldType` stays.
- FROM `extractLookupId`, `TEXTUAL_REF_FALLBACK_TYPES` TO `InlineFieldInput`, which reads lookup values itself.
- FROM `queueClaimAdmitted` TO `useQueueClaimOffered`, which answers whether the Claim button shows.
- FROM `useDefaultRecordPage` TO `DefaultRecordPageContext` with `useContext`.
- FROM `relatedCountTargetOf` TO `relatedCountTargetsIn`.
- FROM `filterTimelineStream` TO `mergeTimelineStream`; the timeline panel applies its filter chips itself.
- FROM `RELATED_CARD_NEW_BADGE_MS`, `editRelatedArrangement`, `relatedCardId`, `relatedDefaultOrderHash`, `RelatedArrangementEdit` TO `resolveRelatedArrangement` with `relatedArrangementFromRecord` / `relatedArrangementToRecord`; the related cards edit and badge the arrangement themselves.
- FROM `DetailTabsProps` TO `DetailViewProps`: `DetailTabs` is not on the entry, `DetailView` renders it.
