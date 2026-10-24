/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Zod Validation Schemas
 * 
 * Complete Zod validation schemas for all ObjectUI components.
 * Following @objectstack/spec UI specification format.
 * 
 * ## Usage
 * 
 * ```typescript
 * import { ButtonSchema, InputSchema, FormSchema } from '@object-ui/types/zod';
 * 
 * // Validate a schema
 * const result = ButtonSchema.safeParse({
 *   type: 'button',
 *   label: 'Click Me',
 *   variant: 'primary',
 * });
 * 
 * if (result.success) {
 *   console.log('Valid schema:', result.data);
 * } else {
 *   console.error('Validation errors:', result.error);
 * }
 * ```
 *
 * ## ⭐ This mirror authors no default, imported subschemas included
 *
 * `result.data` is the document you handed in. This face VALIDATES; it does not
 * write values into an author's document — not on the keys this package
 * declares (objectui#7735, decision batch #69) and not on the keys it imports
 * by reference from `@objectstack/spec` (objectui#8317, decision batch #90).
 * An author who writes `navigation: {}` gets `navigation: {}` back, not
 * `navigation: { mode: 'page', preventNavigation: false, openNewTab: false,
 * size: 'auto' }`.
 *
 * ⇒ There is no key on this face whose presence in `result.data` means anything
 * other than "the author wrote it", and no import graph to read to find out
 * which keys those are. The authoritative default for a key is the RENDERER's
 * own fallback, which is what actually runs; a `@default` JSDoc tag DESCRIBES
 * that fallback and never installs one.
 *
 * ⛔ So: no `.default()` in `zod/*.zod.ts`, and every `@objectstack/spec` schema
 * crossing into a mirror shape wrapped in `stripImportedDefaults`
 * (`zod/imported-defaults.ts`). Both halves are ratcheted at zero by
 * `__tests__/zod-mirror-authors-no-defaults-7735.test.ts` and
 * `__tests__/imported-defaults-8317.test.ts`. The accept set is unchanged by
 * either: a key that was omissible stays omissible.
 *
 * @packageDocumentation
 */

// ============================================================================
// Application - Global Configuration
// ============================================================================
export {
  AppComponentSchema,
  NavigationItemSchema,
  NavigationItemTypeSchema,
  NavigationAreaSchema,
  MenuItemSchema as AppMenuItemSchema,
  // objectui#11440 — the `app-schema-renderer` whole-shell node.
  AppSchemaRendererNodeSchema,
} from './app.zod.js';

// ============================================================================
// Base Schema - Foundation
// ============================================================================
export {
  BaseSchema,
  SchemaNodeSchema,
  ComponentInputControlTypeSchema,
  ComponentInputSchema,
  ComponentMetaSchema,
  ComponentConfigSchema,
  HTMLAttributesSchema,
  ClassNameStylePropsSchema,
} from './base.zod.js';

// ============================================================================
// Expression wire shape - shared by the predicate keys (objectui#7530)
// ============================================================================
export { ExpressionWireSchema } from './expression.zod.js';

// ============================================================================
// Layout Components - Structure & Organization
// ============================================================================
export {
  DivSchema,
  BoxSchema,
  TextSpanSchema,
  TextSchema,
  ImageSchema,
  IconSchema,
  SeparatorSchema,
  ContainerSchema,
  // objectui#11276's `FlexBlockSchema` is the authored `flex` arm, its bag the
  // flat mirror's own members (the spec has no row for it); `FlexSchema` stays
  // the node as the `flex` renderer reads it.
  FlexSchema,
  FlexBlockSchema,
  StackSchema,
  GridSchema,
  CardSchema,
  TabItemSchema,
  TabsSchema,
  ScrollAreaSchema,
  ResizablePanelSchema,
  ResizableSchema,
  AspectRatioSchema,
  PageRegionWidthSchema,
  PageNodeRegionSchema,
  PageVariableSchema,
  PageTypeSchema,
  PageNodeSchema,
  // objectui#11440 — the spec page kinds `record` / `home` / `utility`.
  PageKindNodeSchema,
  LayoutSchema,
  // ⛔ `SemanticElementSchema` and `HtmlElementSchema` are deliberately NOT
  // exported (objectui#9067, decision batch #121 item 5, maintainer 2026-09-12).
  // Both are FAMILY schemas keyed by a tag `z.enum`, so a name bound to either
  // would hand a consumer a schema accepting every tag in the family rather than
  // the one node type every other name on this barrel stands for. objectui#8499's
  // changeset stated the reason when it armed them and deferred the naming:
  // exporting the pair "would publish a NAMED authoring surface (`z.enum`
  // families, not per-tag schemas)". Splitting them into per-tag schemas was
  // ruled out in the same breath — expansion for a consumer nobody has measured.
  // `__tests__/arm-named-export-8784.test.ts` carries the rows that re-read this
  // on every run; that ledger, not this comment, is what fails if it stops being true.
} from './layout.zod.js';

// ============================================================================
// Form Components - User Input & Interaction
// ============================================================================
export {
  SelectOptionSchema,
  RadioOptionSchema,
  ComboboxOptionSchema,
  CommandItemSchema,
  CommandGroupSchema,
  FieldConstraintsSchema,
  FieldConditionSchema,
  ButtonSchema,
  InputSchema,
  // The `email` / `password` shorthand arm, named here by the objectui#9067
  // ruling (decision batch #121 item 5): it stands for two `type` literals, so
  // naming it keeps this barrel's meaning — one name, one node type.
  InputShorthandSchema,
  TextareaSchema,
  SelectSchema,
  CheckboxSchema,
  RadioGroupSchema,
  SwitchSchema,
  ToggleSchema,
  SliderSchema,
  FileUploadSchema,
  DatePickerSchema,
  CalendarSchema,
  // `ui:calendar` — the date-picker primitive `renderers/form/calendar.tsx`
  // registers, a different component from the `calendar` plugin VIEW above.
  // One `type` literal, so the same objectui#9067 ruling names it.
  UiCalendarSchema,
  InputOTPSchema,
  ComboboxSchema,
  LabelSchema,
  CommandSchema,
  FormFieldSchema,
  FormSchema,
  CodeEditorSchema,
  FormComponentSchema,
} from './form.zod.js';

// ============================================================================
// Data Display Components - Information Presentation
// ============================================================================
export {
  AlertSchema,
  StatisticSchema,
  BadgeSchema,
  AvatarSchema,
  ListItemSchema,
  ListSchema,
  TableColumnSchema,
  StaticTableColumnSchema,
  TableSchema,
  DataTableSchema,
  MarkdownSchema,
  TreeNodeSchema,
  TreeViewSchema,
  ChartTypeSchema,
  ChartDataSeriesSchema,
  DrillDownConfigSchema,
  ChartSchema,
  PivotTableSchema,
  TimelineEventSchema,
  TimelineFeedItemSchema,
  TimelineGanttItemSchema,
  TimelineGanttItemBarSchema,
  TimelineSchema,
  KbdSchema,
  HtmlSchema,
  BarChartSchema,
  DataDisplaySchema,
} from './data-display.zod.js';

// ============================================================================
// Feedback Components - Status & Progress Indication
// ============================================================================
export {
  LoadingSchema,
  ProgressSchema,
  SkeletonSchema,
  ToastSchema,
  ToasterSchema,
  SpinnerSchema,
  EmptySchema,
  SonnerSchema,
  FeedbackSchema,
} from './feedback.zod.js';

// ============================================================================
// Disclosure Components - Collapsible Content
// ============================================================================
export {
  AccordionItemSchema,
  AccordionSchema,
  CollapsibleSchema,
  ToggleGroupItemSchema,
  ToggleGroupSchema,
  DisclosureSchema,
} from './disclosure.zod.js';

// ============================================================================
// Overlay Components - Modals & Popovers
// ============================================================================
export {
  DialogSchema,
  AlertDialogSchema,
  SheetSchema,
  DrawerSchema,
  PopoverSchema,
  TooltipSchema,
  HoverCardSchema,
  MenuItemSchema,
  DropdownMenuSchema,
  ContextMenuSchema,
  MenubarMenuSchema,
  MenubarSchema,
  OverlaySchema,
} from './overlay.zod.js';

// ============================================================================
// Navigation Components - Menus & Navigation
// ============================================================================
export {
  NavLinkSchema,
  HeaderBarSchema,
  SidebarSchema,
  BreadcrumbSchema,
  PaginationSchema,
  NavigationMenuItemSchema,
  NavigationMenuSchema,
  ButtonGroupButtonSchema,
  ButtonGroupSchema,
  NavigationSchema,
} from './navigation.zod.js';

// ============================================================================
// Complex Components - Advanced/Composite Components
// ============================================================================
export {
  KanbanCardSchema,
  KanbanColumnSchema,
  CardTemplateSchema,
  // ⛔ `KanbanSchema` RETIRED with the bare `kanban` node type key
  // (objectui#8802, maintainer ruling 2026-09-09). `RetiredKanbanNodeSchema`
  // takes its place inside `ComplexSchema` so an authored `type: "kanban"` is
  // refused BY NAME and pointed at `object-kanban`; it is deliberately NOT
  // exported — nothing outside this package parses against a refusal arm.
  CalendarViewModeSchema,
  CalendarEventSchema,
  CalendarViewSchema,
  FilterOperatorSchema,
  FilterBuilderConditionSchema,
  FilterGroupSchema,
  FilterFieldSchema,
  FilterBuilderSchema,
  CarouselItemSchema,
  CarouselSchema,
  ChatToolInvocationSchema,
  ChatMessageSourceSchema,
  ChatMessageSchema,
  ChatbotSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  DashboardWidgetLayoutSchema,
  DashboardWidgetTypeSchema,
  DashboardWidgetSchema,
  DashboardComponentSchema,
  DashboardWidgetConfigSchema,
  DashboardConfigSchema,
  ComplexSchema,
} from './complex.zod.js';

// ============================================================================
// ObjectQL Components - Smart Data Components
// ============================================================================
export {
  HttpMethodSchema,
  HttpRequestSchema,
  ViewDataSchema,
  ListColumnSchema,
  SelectionConfigSchema,
  PaginationConfigSchema,
  SortConfigSchema,
  ObjectGridSchema,
  ObjectFormSchema,
  ObjectViewSchema,
  ObjectMapSchema,
  ObjectMapConfigSchema,
  ObjectTreeSchema,
  ObjectGanttSchema,
  ObjectCalendarSchema,
  ObjectKanbanSchema,
  ObjectChartSchema,
  ObjectGallerySchema,
  ObjectDataTableSchema,
  ListViewSchema,
  ObjectQLComponentSchema,
  // objectui#10859 batches 2 to 6 — ADR-0080 public blocks armed from their
  // `ComponentPropsMap` rows, and the union they reach `AnyComponentSchema` by.
  // Batch 4's `ObjectFormBlockSchema`, batch 5's `ObjectMapBlockSchema` and
  // batch 6's `ObjectGanttBlockSchema` are the authored `object-form` /
  // `object-map` / `object-gantt` arms; `ObjectFormSchema`, `ObjectMapSchema`
  // and `ObjectGanttSchema` above stay the nodes as their renderers read them.
  // objectui#11276's `ObjectChartBlockSchema` is the authored `object-chart`
  // arm, its bag the flat mirror's own members (the spec has no row for it);
  // `ObjectChartSchema` above stays the node as `ObjectChart` reads it. Its
  // `object-grid` batch's `ObjectGridBlockSchema` is the authored `object-grid`
  // arm, from its row; `ObjectGridSchema` above stays the node as `ObjectGrid`
  // reads it, and builds the `object-view` `table` slot.
  ObjectMetricBlockSchema,
  ObjectMasterDetailFormBlockSchema,
  ObjectTimelineBlockSchema,
  ObjectFormBlockSchema,
  ObjectMapBlockSchema,
  ObjectChartBlockSchema,
  ObjectGanttBlockSchema,
  ObjectGridBlockSchema,
  // objectui#11440 — two Tier A public blocks with no spec row, each bag built
  // from the block's registration inputs.
  ObjectPivotBlockSchema,
  EmbeddableFormBlockSchema,
  // objectui#12670 — the authored page `list-view` arm, its bag the flat
  // mirror's own members with the list kind as `type` and `objectName` /
  // `viewType` refused by name; `ListViewSchema` above stays the `ListView`
  // component's props.
  ListViewBlockSchema,
  ObjectQLPublicBlockComponentSchema,
} from './objectql.zod.js';

// ============================================================================
// CRUD Components - Create, Read, Update, Delete Operations
// ============================================================================
export {
  ActionExecutionModeSchema,
  ActionSchema,
  DetailSchema,
  CRUDDialogSchema,
  CRUDComponentSchema,
} from './crud.zod.js';

// ============================================================================
// Phase 2 Schemas - Theme, Reports, Blocks, and Views
// ============================================================================
// `./theme.zod` exports NOTHING any more — the module is kept only as the
// tombstone for the retired theme component-kind surface:
// - `ColorPaletteSchema` / `TypographySchema` / `BorderRadiusSchema` /
//   `ShadowSchema` / `ThemeModeSchema` / `ThemeDefinitionSchema` RETIRED with
//   the spec's whole `ui/theme.zod.ts` module (objectstack `35ad101bc`;
//   removal ruled on objectstack#10856, executed as
//   objectui#5710).
// - `ThemeComponentSchema` RETIRED in `78cbdb530`.
// - `ThemeSwitcherSchema` / `ThemePreviewSchema` / `ThemeUnionSchema` RETIRED
//   in objectui#5647, by inheritance of the same 2026-08-21 ruling (option B)
//   on identical evidence — `AnyComponentSchema` below no longer carries a
//   theme member.

export {
  ReportExportFormatSchema,
  ReportScheduleFrequencySchema,
  ReportAggregationTypeSchema,
  ReportFieldSchema,
  ReportFilterSchema,
  ReportGroupBySchema,
  ReportSectionSchema,
  ReportScheduleSchema,
  ReportExportConfigSchema,
  ReportComponentSchema,
  // objectui#11440 — the authored `report` node: the record plus the `report` wrapper.
  ReportNodeSchema,
  ReportBuilderSchema,
  ReportViewerSchema,
  ReportUnionSchema,
} from './reports.zod.js';

// `./blocks.zod` exports NOTHING any more — the module is kept only as the
// tombstone for the retired block schema family. `BlockVariableSchema`,
// `BlockSlotSchema`, `BlockMetadataSchema`, `BlockSchema`,
// `BlockLibraryItemSchema`, `BlockLibrarySchema`, `BlockEditorSchema`,
// `BlockInstanceSchema`, `ComponentSchema` and the `BlockComponentSchema`
// union over them RETIRED in objectui#4895 (ADR-0049 enforce-or-remove,
// maintainer ruling 2026-09-02, option C1). `AnyComponentSchema` below no
// longer carries a block arm, so `{ type: 'block' | 'block-library' |
// 'block-editor' | 'block-instance' | 'component' }` is now refused rather
// than green-lit for a node no page can render.

export {
  ViewTypeSchema,
  DetailViewFieldSchema,
  DetailViewSectionSchema,
  DetailViewTabSchema,
  DetailViewSchema,
  // objectui#11440 — one field section as a node.
  DetailSectionNodeSchema,
  ViewSwitcherSchema,
  FilterUISchema,
  SortUISchema,
  ViewComponentSchema,
} from './views.zod.js';

// ============================================================================
// AI Components - `@object-ui/plugin-ai` (objectui#10859)
// ============================================================================
export {
  AIConfigSchema,
  AIFieldSuggestionSchema,
  AIFormAssistSchema,
  AIRecommendationItemSchema,
  AIRecommendationsSchema,
  NLQueryResultSchema,
  NLQuerySchema,
  AIComponentSchema,
} from './ai.zod.js';

// ============================================================================
// Product-page blocks - `@object-ui/app-shell` (objectui#12197)
// ============================================================================
export {
  HeroBlockSchema,
  StatBlockSchema,
  UsageBarBlockSchema,
  ChecklistBlockItemSchema,
  ChecklistBlockSchema,
  TileGridBlockItemSchema,
  TileGridBlockAddTileSchema,
  TileGridBlockSchema,
  ProductBlockComponentSchema,
} from './product-blocks.zod.js';
export type { ProductBlockComponentZodType } from './product-blocks.zod.js';

// ============================================================================
// Designer Components - `@object-ui/plugin-designer` (objectui#10859)
// ============================================================================
export {
  DesignerPositionSchema,
  DesignerCanvasConfigSchema,
  DesignerComponentSchema,
  DesignerPaletteItemSchema,
  DesignerPaletteCategorySchema,
  PageDesignerSchema,
  DataModelFieldSchema,
  DataModelEntitySchema,
  DataModelRelationshipSchema,
  DataModelDesignerSchema,
  BPMNNodeSchema,
  BPMNEdgeSchema,
  BPMNLaneSchema,
  ProcessDesignerSchema,
  ReportDesignerElementSchema,
  ReportDesignerSectionSchema,
  ReportDesignerSchema,
  ObjectDefinitionSchema,
  ObjectManagerSchema,
  DesignerFieldOptionSchema,
  DesignerFieldDefinitionSchema,
  FieldDesignerSchema,
  DesignerUnionSchema,
} from './designer.zod.js';

// ============================================================================
// ADR-0080 Public Blocks - the spec-row `page:` / `record:` / `element:` /
// `action:` blocks (objectui#10872)
// ============================================================================
export {
  PageHeaderBlockSchema,
  PageTabsBlockSchema,
  PageCardBlockSchema,
  PageAccordionBlockSchema,
  PageSectionBlockSchema,
  PageFooterBlockSchema,
  PageSidebarBlockSchema,
  RecordDetailsBlockSchema,
  RecordHighlightsBlockSchema,
  RecordRelatedListBlockSchema,
  RecordPathBlockSchema,
  RecordActivityBlockSchema,
  RecordDiscussionBlockSchema,
  RecordHistoryBlockSchema,
  RecordQuickActionsBlockSchema,
  RecordReferenceRailBlockSchema,
  RecordAlertBlockSchema,
  RecordLineItemsBlockSchema,
  ElementTextBlockSchema,
  ElementNumberBlockSchema,
  ElementButtonBlockSchema,
  ElementDividerBlockSchema,
  ElementDefinitionListBlockSchema,
  ElementRepeaterBlockSchema,
  ActionButtonBlockSchema,
  ActionIconBlockSchema,
  ActionGroupBlockSchema,
  ActionMenuBlockSchema,
  PublicBlockComponentSchema,
} from './public-blocks.zod.js';

// ============================================================================
// Cloud Widgets - `@object-ui/app-shell`'s `cloud:` SDUI widgets (objectui#10919)
// ============================================================================
// ⛔ `CloudPlanStatusSchema` RETIRED with the `cloud:plan-status` widget
// (objectui#12954). `RetiredCloudPlanStatusNodeSchema` takes its place inside
// `AnyComponentSchema` so an authored `type: "cloud:plan-status"` is refused BY
// NAME with its remedy; it is deliberately NOT exported — nothing outside this
// package parses against a refusal arm.
export { CloudWorkspaceTimezoneNoticeSchema } from './cloud.zod.js';

// ============================================================================
// `record:approval_decision` - `@object-ui/app-shell`'s approval decision panel (objectui#12342)
// ============================================================================
export { RecordApprovalDecisionBlockSchema } from './record-approval-decision.zod.js';

// ============================================================================
// `record:approvals` / `record:attachments` - `@object-ui/app-shell`'s record panels (objectui#12363)
// ============================================================================
export { RecordApprovalsBlockSchema, RecordAttachmentsBlockSchema } from './record-panels.zod.js';

// ============================================================================
// Union Types - All Component Schemas
// ============================================================================

import { z } from 'zod';
import { defineNodeComponentUnion } from './base.zod.js';
import { AppComponentSchema, AppSchemaRendererNodeSchema } from './app.zod.js';
import { LayoutSchema, PageKindNodeSchema } from './layout.zod.js';
import { FormComponentSchema } from './form.zod.js';
import { DataDisplaySchema } from './data-display.zod.js';
import { FeedbackSchema } from './feedback.zod.js';
import { DisclosureSchema } from './disclosure.zod.js';
import { OverlaySchema } from './overlay.zod.js';
import { NavigationSchema } from './navigation.zod.js';
import { ComplexSchema } from './complex.zod.js';
import { ObjectQLComponentSchema, ObjectQLPublicBlockComponentSchema } from './objectql.zod.js';
import { CRUDComponentSchema } from './crud.zod.js';
import { ReportUnionSchema } from './reports.zod.js';
import { ViewComponentSchema } from './views.zod.js';
import { AIComponentSchema } from './ai.zod.js';
import { ProductBlockComponentSchema } from './product-blocks.zod.js';
import { DesignerUnionSchema } from './designer.zod.js';
import { PublicBlockComponentSchema } from './public-blocks.zod.js';
import { CloudWorkspaceTimezoneNoticeSchema, RetiredCloudPlanStatusNodeSchema } from './cloud.zod.js';
import { RecordApprovalDecisionBlockSchema } from './record-approval-decision.zod.js';
import { RecordApprovalsBlockSchema, RecordAttachmentsBlockSchema } from './record-panels.zod.js';
import { nestedComponentJudgment } from './nested-component-walk.js';

/**
 * Union of all component schemas.
 * Use this for generic component rendering where the type is determined at runtime.
 *
 * ⭐ It is ALSO the node recursion point (objectui#8344): every child slot is
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`, and `SchemaNodeSchema`
 * resolves its component arm to THIS union, so a nested node is judged by its own
 * component schema at every depth instead of by the ~21 base keys. The wiring is a
 * late-binding holder rather than an import because the category modules import
 * `base.zod.js` and this module is built from all of them — the full reasoning, and
 * what the UNFILLED holder answers, live on `SchemaNodeSchema` in `base.zod.ts`.
 *
 * ⚠️ The fill is written as this const's own initializer, not as a statement beside
 * it, so no bundler can keep the union and drop the wiring, and no future edit can
 * reorder the two. ⛔ Do not "simplify" it back into a bare
 * `defineNodeComponentUnion(AnyComponentSchema)` call underneath.
 *
 * ## Why this is discriminated (objectui#8498)
 *
 * A flat `z.union` reports EVERY arm's issues under one `invalid_union`, and
 * Zod's `$ZodError` initializer `JSON.stringify`s that whole tree into
 * `.message` EAGERLY — `zod/v4/core/errors.js:13`, in the constructor, not
 * behind a getter. The cost is paid whether or not anyone reads the message,
 * and it compounds once a refused node can appear at a child slot: a root-level
 * refusal cost 14,624 chars, growing ~25x per level of nesting until
 * `RangeError: Invalid string length` — a THROW out of the function this file
 * documents below as validating "without throwing". Discriminating selects ONE
 * arm from the authored literal: same document, same zod 4.4.3, 164 chars.
 *
 * ⛔ Not an accept-set change, and the property it rests on is measured rather
 * than assumed: the 13 arms declare 107 `type` literals with ZERO collisions,
 * so the arm a literal selects is the only arm that could ever have accepted
 * it. ⚠️ Every arm must declare its literals to Zod — a plain `z.union` member
 * computes no `propValues` and is REFUSED here (`Invalid discriminated union
 * option at index "9"`), which is why `objectql.zod.ts` and `crud.zod.ts` are
 * discriminated too. `__tests__/any-component-union-fanout.test.ts` pins all of
 * it.
 *
 * ⚠️ BOTH of the above are live here, and the composition is the whole resolution:
 * objectui#8498 changed WHICH arm reports, objectui#8344 changed WHERE this union is
 * consulted. The discriminated union is what gets written into the node option slot,
 * unchanged: `defineNodeComponentUnion` installs it as it stands. ⚠️ AMENDED
 * (objectui#9659) — this used to read "so `defineNodeComponentUnion` wraps it rather
 * than replacing it", which named the `superRefine` clause objectui#8344 carried on the
 * installed arm. Ruling A on objectui#8572 retired the key that clause narrowed,
 * objectui#9659 measured that it could no longer fire for any input, and it is gone; the
 * fill is an installation and nothing more. The slot itself is
 * still a plain `z.union` in `base.zod.ts` — that is what keeps its option array by
 * reference, and it is untouched by the discrimination.
 *
 * ## Why every category union's TYPE is named (objectui#11573)
 *
 * `tsc` prints an inferred type in full wherever a declaration uses it, and it
 * refuses to print one past its serialization ceiling with TS7056 ("The
 * inferred type of this node exceeds the maximum length the compiler will
 * serialize"); `@object-ui/types` then emits no declarations at all, and every
 * consumer of `./zod` fails with TS7016. This declaration lists the members
 * below, so printed inline it is the SUM of every category's print — the
 * `Spec Main Shape Gate` caught it crossing the ceiling, and single arms were
 * named one TS7056 at a time to stay under it (`AppSchemaRendererNodeSchemaType`,
 * `PageKindNodeSchemaType`, `ReportNodeZodType`, `RecordLineItemsBlockSchemaType`)
 * until objectui#11573 measured what was left: under one percent of the ceiling.
 *
 * So every category union listed here has a NAMED type: an exported interface
 * in its own module that extends the union's inferred type and adds no member
 * (`LayoutZodType`, `PublicBlockComponentZodType` and their siblings). An
 * interface is printed by name, so each union's body is printed once, in its
 * own module's declaration, and this declaration prints a reference to it. The
 * TYPES are unchanged: the value is the union itself, and `z.input` / `z.output`
 * read the union's own internals. Only the printed `.d.ts` text moved.
 *
 * ⚠️ A member added below is printed inline unless its type is named the same
 * way. `__tests__/any-component-emit-headroom-11573.test.ts` reads this
 * declaration's size with the compiler's own counter, fails when it crosses its
 * stated margin below the ceiling, and lists every member as named or inline,
 * so a new member turns it red until it is classified there.
 */
export const AnyComponentSchema = defineNodeComponentUnion(z.discriminatedUnion('type', [
  AppComponentSchema,
  AppSchemaRendererNodeSchema,
  LayoutSchema,
  // objectui#11440 — the spec page kinds `record` / `home` / `utility`. An arm
  // of its own rather than a member of `LayoutSchema`, whose enum-keyed arms are
  // the two html-tag families that `@object-ui/core`'s html-tier roster pin
  // (`html-tier-intrinsics.test.ts`) finds by that shape.
  PageKindNodeSchema,
  FormComponentSchema,
  DataDisplaySchema,
  FeedbackSchema,
  DisclosureSchema,
  OverlaySchema,
  NavigationSchema,
  ComplexSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  CRUDComponentSchema,
  ReportUnionSchema,
  ViewComponentSchema,
  AIComponentSchema,
  DesignerUnionSchema,
  PublicBlockComponentSchema,
  // objectui#12954 — the retired `cloud:plan-status` literal's named refusal.
  RetiredCloudPlanStatusNodeSchema,
  CloudWorkspaceTimezoneNoticeSchema,
  // objectui#12342 — landed with its registration.
  RecordApprovalDecisionBlockSchema,
  // objectui#12363 — the two record panels the default record page emits.
  RecordApprovalsBlockSchema,
  RecordAttachmentsBlockSchema,
  ProductBlockComponentSchema,
], {
  // Zod's default message for a missed discriminator spells out EVERY accepted
  // literal — measured, 1,462 chars naming all 107. That is the "print every
  // arm" output the 2026-09-02 maintainer ruling rejected as noise, arriving by
  // the back door on a card about message size. `Invalid input` is what the flat
  // union reported here before, so the published root diagnostic is unchanged;
  // the ruling's capped list stays the one place arm names are printed, built by
  // `@object-ui/cli` from `issue.options`, which this does not touch.
  // ⚠️ Narrowed to `invalid_union`: an unconditional map is scoped to the WHOLE
  // schema, so it also rewrote this union's `invalid_type` and a non-object root
  // lost "expected object, received number". `undefined` declines to the locale.
  error: (issue) => (issue.code === 'invalid_union' ? 'Invalid input' : undefined),
  // objectui#11223: a component nested in a props bag — at the positions
  // `@objectstack/spec`'s own page walk descends — is judged by this same union,
  // at its real path. `./nested-component-walk.ts` carries the why and the how;
  // the strict face re-points this check at its own twin of the union.
}).check(nestedComponentJudgment((): z.ZodType => AnyComponentSchema)));

/**
 * Validate a schema against the AnyComponentSchema
 * 
 * @param schema - The schema to validate
 * @returns The validated and typed schema
 * @throws ZodError if validation fails
 * 
 * @example
 * ```typescript
 * import { validateSchema } from '@object-ui/types/zod';
 * 
 * try {
 *   const validSchema = validateSchema({
 *     type: 'button',
 *     label: 'Click Me',
 *   });
 *   console.log('Valid schema:', validSchema);
 * } catch (error) {
 *   console.error('Validation failed:', error);
 * }
 * ```
 */
export function validateSchema(schema: unknown) {
  return AnyComponentSchema.parse(schema);
}

/**
 * Safely validate a schema without throwing errors
 *
 * Every node is judged by its own component schema at every depth: in a
 * node-level child slot (objectui#8344), and in a props-bag child list at the
 * positions `@objectstack/spec`'s page walk descends (objectui#11223), each
 * issue reported at the nested node's real path.
 *
 * @param schema - The schema to validate
 * @returns Object with success boolean and either data or error
 * 
 * @example
 * ```typescript
 * import { safeValidateSchema } from '@object-ui/types/zod';
 * 
 * const result = safeValidateSchema({
 *   type: 'button',
 *   label: 'Click Me',
 * });
 * 
 * if (result.success) {
 *   console.log('Valid schema:', result.data);
 * } else {
 *   console.error('Validation errors:', result.error);
 * }
 * ```
 */
export function safeValidateSchema(schema: unknown) {
  return AnyComponentSchema.safeParse(schema);
}

/**
 * Version information
 */
export const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Strict authoring face — the derived, unknown-key-closing twin (objectui#8345)
// ============================================================================

/**
 * The strict twin of the node face, derived from the mirrors above rather than
 * hand-written, under the objectui#5250 ruling (option 2: "each node schema
 * gets a derived strict variant; `objectui validate` and the doc-snippet gates
 * run strict; renderer props keep the tolerant face unchanged").
 *
 * ⛔ Nothing here changes the accept set of anything exported above. The
 * rendering face keeps its `.passthrough()`; this is a SECOND face, and
 * `objectui validate` and `objectui check` consume it (objectui#5250).
 *
 * ⚠️ The module is `../strict-authoring-face.ts`, OUTSIDE this directory, and
 * the placement is deliberate. `__tests__/zod-mirror-parity.test.ts` runs a
 * census closed over the `export const`s of `src/zod/*.zod.ts`: every one is
 * either a registered hand-written mirror or a declared exclusion. A DERIVED
 * twin restates no declaration and has nothing to drift from, so it is not a
 * member of that population — and it lives outside the directory the census is
 * closed over, which keeps that closure statement exactly as true as it is
 * today rather than needing a new row to say "not really one of these".
 */
export {
  deriveStrictAuthoringSchema,
  StrictAnyComponentSchema,
  StrictSchemaNodeSchema,
} from '../strict-authoring-face.js';
export type {
  DeriveStrictAuthoringOptions,
  StrictAuthoringLimit,
} from '../strict-authoring-face.js';
