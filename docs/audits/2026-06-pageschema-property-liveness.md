# Audit: PageSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/page.zod.ts` (+ PageComponent/InterfaceConfig/PageVariable). **Renderers**: `objectui` `PageView`→`SchemaRenderer`→`components/.../layout/page.tsx`, `plugin-detail` (record path), `InterfaceListPage`.

## 🔴 `bridgePage` (spec-bridge) is entirely dead
`PageView.tsx` spreads the **raw** spec into `SchemaRenderer`; nothing calls `SpecBridge.toPage`. So every prop whose only reader is the bridge is DEAD: component `events`, `style`, `visibility`, element `dataSource`, `responsive`, page `icon`.

## 🔴 `type` → `pageType` naming drift breaks page-type layouts
The custom-page renderer switches on `schema.pageType` (`page.tsx:349`) but the spec emits `type`; only `usePageAssignment` normalizes `pageType ?? type`. So `app`/`home`/`utility` pages rendered via `PageView` **silently collapse to the `record` layout**. Only `template`-named pages route correctly. Same drift: renderer reads `title` (`page.tsx:429`), spec emits `label` → the page header never shows the spec label. Non-spec `priority` is also read for page selection (`usePageAssignment.ts:139`).

## 🔴 Component-level `visibility` (CEL) silently does nothing
`SchemaRenderer` gates on `visible`/`hidden`/`visibleOn`/`hiddenOn` (`:251-262`), **never the spec's `visibility`** — an author-written visibility predicate on a page block is ignored (correctness footgun).

## DEAD — whole config subtrees with zero renderers
`recordReview` (`record_review`), `blankLayout` (`blank`) — and the zod `superRefine` **requires** these for types that have no renderer (validation enforces config for dead features). InterfaceConfig `levels` + `allowPrinting`. `PageVariable.source`. `assignedProfiles`, `isDefault`, `icon`.

## LIVE & well-wired
`name`, `description`, `variables{name,type,defaultValue}`, `object`, `template` (default/full-width/header-sidebar-main/three-column/dashboard), `regions`, `kind`+`slots` (slotted composition via `usePageAssignment`+`buildDefaultPageSchema`), `interfaceConfig` (10/12 sub-props: source/sourceView/appearance/userFilters/userActions/addRecord/filterBy/showRecordCount). PageComponent `type/id/label/properties/className/aria`. Component types: record:* (details/related_list/highlights/activity/chatter/path/quick_actions/history/reference_rail/alert), page:* containers, element:text/number/image/divider/button/repeater all wired. **Aspirational (render "Unknown component type")**: `element:filter`, `element:form`, `element:record_picker`, `ai:chat_window`.

## Recommendation
Fix `type`↔`pageType` and `label`↔`title` at one boundary; route component `visibility` into the live gate (or rename). Either delete `bridgePage` (dead) or wire it. Prune `recordReview`/`blankLayout`/`levels`/`allowPrinting` and stop `superRefine` requiring config for unrendered types.
