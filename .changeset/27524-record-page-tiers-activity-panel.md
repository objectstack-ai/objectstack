---
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

feat(plugin-detail)!: one record page laid out by its own width — details beside a right column from 760 px, one column below; 动态 is the right column's first panel; ⊟ shows or hides the right column

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-detail#RECORD_PAGE_THREE_COLUMN_MIN_WIDTH, @object-ui/plugin-detail#recordPageArrangementFor, @object-ui/plugin-detail#recordPageColumnDefaults, @object-ui/plugin-detail#recordTimelineDefaultReason, @object-ui/plugin-detail#RecordPageColumnSwitches, @object-ui/plugin-detail#RecordPageArrangement, @object-ui/plugin-detail#RecordPageObjectLike, @object-ui/plugin-detail#RecordTimelineDefaultReason, @object-ui/plugin-detail#DefaultPageColumns.relatedCount, @object-ui/plugin-detail#UseRecordPageTierOptions.embedded, @object-ui/plugin-detail#RecordPageColumnsProps.switches) the retired operands are the synthesized record page's layout helpers, their option and prop members, and the types they took, in a published ui package's entry that only the console's own record view imported; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

The synthesized record page (record page v4) is laid out by one rule, the width of the container it occupies. The page, the split pane, the overlay drawer and the maximized pane all follow it.

- **At 760 px and wider**, the details sit beside a right column 320 px wide. **At 1120 px and wider** the right column is 380 px, a details section takes up to three field columns (two otherwise), and the 动态 panel shows five entries (three otherwise).
- **Below 760 px** (the split pane at 720 px, a phone) the page is ONE column: the details, then the right column's panels in their order.
- The three-column tier, the tabbed tier and the 「相关 N」 rail are gone, and so are the resident timeline column, its ⊞ switch and the per-object default that decided it.
- **动态** (formerly the timeline) is the first panel of the right column. It has the same header as a related panel: 「动态」 and the stream's count, and the header row opens the 动态 tab. Its body is a one-line composer (pressed, it opens the full composer, focused), the newest entries one line each, and 「查看全部 N 条」 when the stream holds more. The 动态 tab (`?related=timeline`) is the full stream: the 全部 · 活动 · 讨论 · 变更 chips, threaded replies, and "Load more" for the next page.
- **⊟** (「右栏」, `⌘⇧,`) is one icon at the end of the record header's action row, drawn only where the tier has a right column. Off, the details take the row. It keeps the reader's earlier related-column choice: the stored preference `record.columns.related` is unchanged. The record header's `PanelToggles` (`@object-ui/components`) now draws icon-only toggles named by their label.
- The 动态 panel is on screen at open in every tier, so a synthesized page reads its feed and its audit history at open. An authored page with tabs still waits for the tab that holds them.
- **Tab labels** (`page:tabs`, `@object-ui/components`). A synthesized page that keeps its tab strip (one the layout cannot partition) labels its stream tab `Activity stream`, which the strip reads as 「动态」. An authored `Timeline` tab, such as the served approval page's history, is no longer read as the record stream: it keeps the pack's own word for a timeline (「时间线」, タイムライン, and so on).

**BREAKING** (`@object-ui/plugin-detail`, TypeScript only). The only importer is the console's own record view. `RecordPageTier` is now `'stack' | 'two-column' | 'wide'`: there is no tabbed tier, and the widest tier is called `wide`. `recordPageTierFor(width)` takes no second argument. `useRecordPageTier` answers `null` only while the page is not laid out (disabled, or not yet measured). `RecordPageColumnsProps.tier` takes every `RecordPageTier`. A caller still naming a retired symbol gets a compile error that names it.

What leaves, and what to write instead:

- FROM `RECORD_PAGE_THREE_COLUMN_MIN_WIDTH` TO `RECORD_PAGE_WIDE_MIN_WIDTH`, the same 1120 px floor under its new name.
- FROM `recordPageArrangementFor` TO `recordPageTierHasRightColumn(tier)` and the reader's ⊟: every laid-out page is the details and, where the tier has room, the right column.
- FROM `recordPageColumnDefaults` TO no call: every object's page opens with its right column, and ⊟ defaults to on.
- FROM `recordTimelineDefaultReason` TO no call, for the same reason: no object decides a timeline column any more.
- FROM `RecordPageColumnSwitches` TO a `boolean`, the right column's switch.
- FROM `RecordPageArrangement` TO the `RecordPageTier` itself, read through `recordPageTierHasRightColumn`.
- FROM `RecordPageObjectLike` TO no type: no helper takes an object definition any more.
- FROM `RecordTimelineDefaultReason` TO no type, with `recordTimelineDefaultReason`.
- FROM `DefaultPageColumns.relatedCount` TO the length of `columns.related`; the rail it labelled is gone.
- FROM `UseRecordPageTierOptions.embedded` TO no option: an embedded page follows the same width rule.
- FROM `RecordPageColumnsProps.switches` TO `RecordPageColumnsProps.rightColumn`, one `boolean`.

`RECORD_PAGE_WIDE_MIN_WIDTH`, `recordPageTierHasRightColumn` and `RECORD_PAGE_TIMELINE_PANEL` (the 动态 tab's `?related=` id) are new.
