/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types
 * 
 * Pure TypeScript type definitions for Object UI - The Protocol Layer.
 * 
 * This package contains ZERO runtime dependencies and defines the complete
 * JSON schema protocol for the Object UI ecosystem.
 * 
 * ## Philosophy
 * 
 * Object UI follows a "Schema First" approach where:
 * 1. Types define the protocol (this package)
 * 2. Core implements the engine (@object-ui/core)
 * 3. React provides the framework bindings (@object-ui/react)
 * 4. Components provide the UI implementation (@object-ui/components)
 * 
 * ## Design Principles
 * 
 * - **Protocol Agnostic**: Works with any backend (REST, GraphQL, ObjectQL)
 * - **Framework Agnostic**: Types can be used with React, Vue, or vanilla JS
 * - **Zero Dependencies**: Pure TypeScript with no runtime dependencies
 * - **Tailwind Native**: Designed for Tailwind CSS styling via className
 * - **Type Safe**: Full TypeScript support with strict typing
 * 
 * ## Usage
 * 
 * ```typescript
 * import type { InputSchema, FormSchema, ButtonSchema } from '@object-ui/types';
 * 
 * const loginForm: FormSchema = {
 *   type: 'form',
 *   fields: [
 *     { name: 'email', type: 'input', inputType: 'email', required: true },
 *     { name: 'password', type: 'input', inputType: 'password', required: true }
 *   ]
 * };
 * ```
 * 
 * @packageDocumentation
 */

// ============================================================================
// Application - Global Configuration
// ============================================================================
export type {
  AppComponentSchema,
  // The `app-schema-renderer` node's TS twin (objectui#11515).
  AppSchemaRendererNodeSchema,
  NavigationItem,
  NavigationEntryItem,
  NavigationSeparatorItem,
  NavigationItemType,
  NavigationArea,
  AppMenuItem,
  AppWizardStepId,
  AppWizardStep,
  BrandingConfig,
  ObjectSelection,
  AppWizardDraft,
  EditorMode,
} from './app.js';
export { menuItemToNavigationItem, isValidAppName, wizardDraftToAppSchema } from './app.js';

// Object-level semantic-role readers (ADR-0085), shared across surfaces.
export { detectStatusField } from './record-semantics.js';
export type { StatusFieldSource } from './record-semantics.js';

// Dashboard global-filter legacy alias (ADR-0089 retirement window, #4165) —
// `{ preset: <name> }` → the canonical bare preset name. Read-site helpers, so
// they live on the main entry rather than under `/zod` (they carry no zod).
export {
  liftLegacyGlobalFilterDefault,
  liftLegacyDashboardFilterDefaults,
} from './dashboard-filter-alias.js';

// Dashboard widget layout completion (objectui#11388) — the one helper the
// widget width / height editors write a whole four-number `layout` through, and
// the grid's auto-placement it seeds from. Zod-free, so it belongs on the main
// entry.
export { completeWidgetLayout, defaultWidgetPlacement } from './dashboard-widget-layout.js';

// `ui:icon` glyph-key conversion (objectui#5631) — stored `{ type:'icon',
// name:'check' }` -> `{ type:'icon', icon:'check' }`. A one-shot converter a
// deployer runs over stored metadata; ⛔ NOT a read-path fallback, which the
// ruling excluded by name. Zod-free, so it belongs on the main entry.
export { migrateIconNodeKeys } from './icon-key-migration.js';
export type {
  IconKeyMigrationResult,
  IconKeyMigrationWarning,
} from './icon-key-migration.js';

// ============================================================================
// Base Types - The Foundation
// ============================================================================
export type {
  BaseSchema,
  // objectui's KEYED i18n label — `{ key, defaultValue?, params? }`, a
  // reference INTO a translation bundle. Deliberately NOT the spec's
  // `I18nLabel` re-exported further down this file, which is the INLINE LOCALE
  // MAP; the two are structurally confusable (objectui#4167) and this name is
  // half of what stops them being mixed up (#4581).
  KeyedI18nLabel,
  SchemaNode,
  // The object arm of `SchemaNode`: the discriminated union of the declared
  // node types, plus the custom types an application declares in
  // `CustomNodeRegistry` by declaration merging (objectui#11466).
  DeclaredNode,
  CustomNodeRegistry,
  ComponentRendererProps,
  ComponentInput,
  // The input the FRAMEWORK injects (`binding: 'object'`, `9e37d9b39`) —
  // `ComponentInput` plus the marker no registration may author.
  InjectedComponentInput,
  // The arm vocabulary of `ComponentInput.type`, exported because that field
  // takes one arm OR an array of them (objectui#3832) and every declaration
  // site and reader needs the set by name rather than re-spelling it.
  ComponentInputControlType,
  ComponentMeta,
  ComponentConfig,
  HTMLAttributes,
  EventHandlers,
  StyleProps,
} from './base.js';
// Per-type NODE SLOTS beside `BaseSchema.children` (objectui#11170): where a
// renderer hands authored nodes back to `SchemaRenderer` through a key other
// than `children`, read by the `objectui check` gate, core's `validateChildren`
// and the SDUI parser's manifest projection so that none keeps a list of its own.
export { NODE_SLOT_DECLARATIONS, nodeSlotsFor, nodeSlotPathSegments, nodeSlotValues } from './node-slots.js';
export type { NodeSlotDeclaration, NodeSlotRow, NodeSlotSegment, NodeSlotValue } from './node-slots.js';
// The predicate WIRE shape `BaseSchema.visible` / `.hidden` / `.disabled` and
// the form predicate keys share (objectui#7530): a bare string or the CEL
// envelope `{ dialect?, source }`. Its zod twin is `ExpressionWireSchema` on
// the `./zod` entry.
export type { ExpressionWire } from './expression.js';
// TypeScript authoring types for the spec-declared nodes `BaseSchema` gives no
// face now that objectui#8347 removed its index signature (objectui#11364): the public blocks, the
// `element:text_input` / `element:record_picker` rows, and a stored page
// document under its page kind. Each is derived by reference from its zod arm
// or spec row; `@object-ui/react`'s `SchemaRendererProps.schema` accepts them.
// objectui#11468 adds the other authored `properties`-bag carriers: the eight
// ObjectQL public blocks and `flex`, each its zod arm's input.
export type {
  AuthoringNode,
  PublicBlockNode,
  PublicBlockNodeOf,
  ObjectQLPublicBlockNode,
  ObjectMetricBlockNode,
  ObjectMasterDetailFormBlockNode,
  ObjectTimelineBlockNode,
  ObjectFormBlockNode,
  ObjectMapBlockNode,
  ObjectChartBlockNode,
  ObjectGanttBlockNode,
  ObjectGridBlockNode,
  ObjectPivotBlockNode,
  EmbeddableFormBlockNode,
  ListViewBlockNode,
  FlexBlockNode,
  ElementTextInputNode,
  ElementRecordPickerNode,
  PageDocumentNode,
} from './authoring-nodes.js';

// ============================================================================
// Layout Components - Structure & Organization
// ============================================================================
export type {
  DivSchema,
  BoxSchema,
  TextSpanSchema,
  TextSchema,
  ImageSchema,
  IconSchema,
  SeparatorSchema,
  ContainerSchema,
  FlexLayoutProps,
  FlexSchema,
  StackSchema,
  GridSchema,
  CardSchema,
  TabsSchema,
  TabItem,
  ScrollAreaSchema,
  ResizableSchema,
  ResizablePanel,
  AspectRatioSchema,
  LayoutSchema,
  PageNodeSchema,
  PageSlotMap,
  PageType,
  PageNodeRegion,
  PageRegionWidth,
  PageVariable,
} from './layout.js';

// ============================================================================
// Form Components - User Input & Interaction
// ============================================================================
export type {
  ButtonSchema,
  InputSchema,
  TextareaSchema,
  SelectSchema,
  SelectOption,
  CheckboxSchema,
  RadioGroupSchema,
  RadioOption,
  SwitchSchema,
  SliderSchema,
  FileUploadSchema,
  DatePickerSchema,
  CalendarSchema,
  // The two names on `form.ts`'s export list that this barrel did not carry,
  // added by objectui#9406 (director seat, decision batch #133 item 2, letter
  // (a), maintainer 2026-09-14). Both narrow a schema already on this list
  // — `InputShorthandSchema` is `InputSchema` without `type` / `inputType`,
  // `UiCalendarSchema` is `CalendarSchema` without `type` — and both were
  // already published on `@object-ui/types/form` and `@object-ui/types/zod`,
  // so these two lines ALIGN the third entry point rather than widen the
  // surface. Purely ADDITIVE, the same route objectui#7697 took for
  // `ComboboxOption` above. What made the absence worse than "not found": the
  // root spelling answered `Did you mean 'InputOTPSchema'?` — a different
  // component — steering an author to a compiling, semantically wrong import.
  // `form-barrel-mirror-9406.test.ts` re-derives this list against `form.ts`'s
  // own exports on every run and names whatever is missing, so the gap these
  // lines close cannot reopen unseen.
  InputShorthandSchema,
  UiCalendarSchema,
  FieldValidationRules,
  FieldCondition,
  DependsOnInput,
  FormField,
  FormFieldTab,
  FormFieldPane,
  ComboboxSchema,
  // The element type of `ComboboxSchema.options`, listed next to its schema the
  // way `SelectSchema`/`SelectOption` and `RadioGroupSchema`/`RadioOption`
  // already are (objectui#7697). objectui#7691 made this package the single
  // AUTHORITY for the name — `@object-ui/components` re-exports this
  // declaration instead of forking its own — but left it reachable only
  // through the `@object-ui/types/form` subpath, so the root spelling read
  // TS2305. This line is purely ADDITIVE: the subpath keeps working, and
  // `combobox-option-root-barrel-7697.test.ts` pins BOTH spellings so a later
  // tidy cannot silently drop either one.
  ComboboxOption,
  CommandSchema,
  // The element types `CommandSchema` contains — `groups` holds `CommandGroup`,
  // whose `items` hold `CommandItem` — listed next to their schema the way
  // `ComboboxOption` is above (objectui#9526). Both were already published on
  // `@object-ui/types/form`, and their zod twins `CommandItemSchema` /
  // `CommandGroupSchema` on `@object-ui/types/zod`, while the root spelling read
  // TS2305. Purely ADDITIVE, the objectui#7697 / objectui#9406 route; the gap pin
  // `form-barrel-mirror-9406.test.ts` had ledgered the pair as undecided and
  // now holds it to this list.
  CommandItem,
  CommandGroup,
  InputOTPSchema,
  ToggleSchema,
  FormSchema,
  LabelSchema,
  CodeEditorSchema,
  FormComponentSchema,
} from './form.js';

// The one select-option contract both option faces extend — `SelectOption`
// above (the SDUI form face) and `SelectOptionMetadata` below (the
// object-metadata face). Exported because it appears in the `extends` clause of
// both, so a consumer that wants to name it can (`98d4108a2`).
export type { SelectOptionBase } from './select-option.js';

// ============================================================================
// Data Display Components - Information Presentation
// ============================================================================
export type {
  AlertSchema,
  BadgeSchema,
  AvatarSchema,
  ListSchema,
  ListItem,
  TableColumn,
  StaticTableColumn,
  TableSortItem,
  TableSchema,
  DataTableSchema,
  MarkdownSchema,
  TreeNode,
  TreeViewSchema,
  ChartType,
  ChartDataSeries,
  ChartSchema,
  PivotAggregation,
  PivotTableSchema,
  DrillDownConfig,
  ObjectMetricDrillDownConfig,
  ObjectPivotDrillDownConfig,
  ObjectDataTableDrillDownConfig,
  TimelineEvent,
  TimelineScale,
  TimelineItemVariant,
  TimelineFeedItem,
  TimelineGanttItem,
  TimelineGanttItemBar,
  TimelineSchema,
  KbdSchema,
  HtmlSchema,
  StatisticSchema,
  BarChartSchema,
  DataDisplaySchema,
  TableColumnType,
} from './data-display.js';

// The canonical `TableColumn.type` vocabulary and the producer-seam fold that
// keeps undeclared inference values out of that slot (`fc62bb490`).
export { TABLE_COLUMN_TYPES, normalizeTableColumnType } from './data-display.js';

// ============================================================================
// Feedback Components - Status & Progress Indication
// ============================================================================
export type {
  SpinnerSchema,
  LoadingSchema,
  ProgressSchema,
  SkeletonSchema,
  ToastSchema,
  EmptySchema,
  SonnerSchema,
  ToasterSchema,
  FeedbackSchema,
} from './feedback.js';

// ============================================================================
// Disclosure Components - Collapsible Content
// ============================================================================
export type {
  AccordionItem,
  ToggleGroupSchema,
  AccordionSchema,
  CollapsibleSchema,
  DisclosureSchema,
} from './disclosure.js';

// ============================================================================
// Overlay Components - Modals & Popovers
// ============================================================================
export type {
  OverlayPosition,
  OverlayAlignment,
  DialogSchema,
  AlertDialogSchema,
  SheetSchema,
  DrawerSchema,
  PopoverSchema,
  TooltipSchema,
  HoverCardSchema,
  MenuItem,
  MenuCommandItem,
  MenuDividerItem,
  MenubarSchema,
  DropdownMenuSchema,
  ContextMenuSchema,
  OverlaySchema,
} from './overlay.js';

// ============================================================================
// Navigation Components - Menus & Navigation
// ============================================================================
export type {
  NavLink,
  HeaderBarSchema,
  SidebarSchema,
  BreadcrumbItem,
  BreadcrumbSchema,
  ButtonGroupSchema,
  NavigationMenuSchema,
  NavigationSchema,
  PaginationSchema,
} from './navigation.js';

// ============================================================================
// Complex Components - Advanced/Composite Components
// ============================================================================
export type {
  KanbanCard,
  KanbanColumn,
  // ⛔ `KanbanSchema` RETIRED with the bare `kanban` node type key
  // (objectui#8802, maintainer ruling 2026-09-09) — `ObjectKanbanSchema` below
  // is the surviving kanban face.
  CardTemplate,
  CalendarViewMode,
  CalendarEvent,
  CalendarViewSchema,
  // ⛔ `FilterBuilderOperator` RETIRED from this package (objectui#6349,
  // batch 12): it was the spec's `ViewFilterOperator` under a second name, beside
  // `@object-ui/components`' own `FilterBuilderOperator`. The row's `operator`
  // is typed by the spec's name; import `ViewFilterOperator` from
  // `@objectstack/spec/ui`.
  FilterBuilderCondition,
  FilterGroup,
  FilterBuilderSchema,
  FilterField,
  CarouselItem,
  CarouselSchema,
  DashboardWidgetLayout,
  DashboardWidgetSchema,
  DashboardWidgetSlotComponentSchema,
  DashboardComponentSchema,
  DashboardComponentWidgetType,
  DashboardWidgetTypeExtension,
  DashboardWidgetTypeName,
  ChatMessage,
  ChatMessageSource,
  ChatToolInvocation,
  ChatbotSchema,
  ChatbotEnhancedSchema,
  ChatbotFloatingSchema,
  FloatingChatbotConfig,
  ComplexSchema,
} from './complex.js';

/**
 * The two CLOSED extension sets a dashboard widget's `type` may draw on beyond
 * the spec's own families (objectui#4600, maintainer ruling 2026-08-14).
 */
export {
  DASHBOARD_COMPONENT_WIDGET_TYPES,
  DASHBOARD_WIDGET_TYPE_EXTENSIONS,
} from './complex.js';

// ============================================================================
// Data Management - Backend Integration
// ============================================================================
export type {
  QueryParams,
  QueryResult,
  DataSource,
  ConnectionState,
  DeleteViewResult,
  ViewHomeDeleteOutcome,
  GlobalSearchHit,
  GlobalSearchResult,
  BatchRef,
  BatchTransactionOperation,
  DataScope,
  DataContext,
  DataBinding,
  ValidationError,
  APIError,
  FileUploadResult,
  AggregateParams,
  AggregateResult,
  DataSourceMutationEvent,
  ImportWriteMode,
  ImportFieldMappingEntry,
  ImportRequestOptions,
  ImportRowResult,
  ImportRecordsResult,
  ImportJobStatus,
  CreateImportJobResult,
  ImportJobProgressInfo,
  ImportJobResultsInfo,
  ImportJobSummaryInfo,
  ImportJobUndoResult,
  ListImportJobsOptions,
  ExportDownloadRequest,
} from './data.js';

// ============================================================================
// CRUD Components - Create, Read, Update, Delete Operations
// ============================================================================
export type {
  ActionSchema,
  DetailSchema,
  CRUDDialogSchema,
  CRUDComponentSchema,
} from './crud.js';

// ============================================================================
// ObjectQL Components - ObjectQL-specific components
// ============================================================================
export type {
  // Schema types aligned with @objectstack/spec
  HttpMethod,
  HttpRequest,
  ViewData,
  ListColumn,
  SelectionConfig,
  PaginationConfig,
  KanbanConfig,
  CalendarConfig,
  GanttConfig,
  ListViewTimelineConfig,
  SortConfig,
  // ConditionalFormatting: the spec rule, and the grid / list-view rule built on it
  // (one dialect since objectui#11533; the native rule's interface is gone)
  SpecConditionalFormattingRule,
  ConditionalFormattingRule,
  // Component schemas
  ObjectMapSchema,
  ObjectMapConfig,
  ObjectTreeSchema,
  ObjectGanttSchema,
  ObjectCalendarSchema,
  ObjectKanbanSchema,
  KanbanConditionalFormattingRule,
  ObjectChartSchema,
  ObjectGallerySchema,
  ObjectDataTableSchema,
  ListViewSchema,
  ListViewExportFormat,
  ListViewExportOptions,
  ObjectGridSchema,
  ObjectFormSchema,
  ObjectFormSection,
  SubmitBehavior,
  ObjectViewSchema,
  NamedListView,
  ViewNavigationConfig,
  RecordNavigateAction,
  ViewTabBarConfig,
  ObjectQLComponentSchema,
  ObjectCalendarBlockConfig,
  BulkActionDef,
  BulkActionParam,
  BulkActionOperation,
} from './objectql.js';

// ============================================================================
// Record Components - Spec-aligned record:* page component props
// ============================================================================
export type {
  RecordComponentAriaProps,
  RecordDetailsComponentProps,
  RecordHighlightsComponentProps,
  RecordRelatedListComponentProps,
  RecordActivityComponentProps,
  RecordChatterComponentProps,
  RecordPathComponentProps,
} from './record-components.js';

// ============================================================================
// Field Types - ObjectQL Field Type System
// ============================================================================
export type {
  BaseFieldMetadata,
  FieldDependsOn,
  VisibilityCondition,
  FieldValidationFunction,
  TextFieldMetadata,
  TextareaFieldMetadata,
  MarkdownFieldMetadata,
  HtmlFieldMetadata,
  RichtextFieldMetadata,
  NumberFieldMetadata,
  CurrencyFieldMetadata,
  PercentFieldMetadata,
  BooleanFieldMetadata,
  DateFieldMetadata,
  DateTimeFieldMetadata,
  TimeFieldMetadata,
  SelectFieldMetadata,
  SelectOptionMetadata,
  EmailFieldMetadata,
  PhoneFieldMetadata,
  UrlFieldMetadata,
  PasswordFieldMetadata,
  FileFieldMetadata,
  UploadedFileMetadata,
  ImageFieldMetadata,
  LocationFieldMetadata,
  LookupFieldMetadata,
  LookupColumnDef,
  LookupFilterDef,
  FormulaFieldMetadata,
  SummaryFieldMetadata,
  AutoNumberFieldMetadata,
  UserFieldMetadata,
  ObjectFieldMetadata,
  VectorFieldMetadata,
  GridFieldMetadata,
  ColorFieldMetadata,
  CodeFieldMetadata,
  AvatarFieldMetadata,
  SignatureFieldMetadata,
  QRCodeFieldMetadata,
  AddressFieldMetadata,
  GeolocationFieldMetadata,
  SliderFieldMetadata,
  RatingFieldMetadata,
  MasterDetailFieldMetadata,
  FieldMetadata,
  ObjectSchemaMetadata,
  ObjectSchemaClientExtensions,
  ObjectIndex,
  GridFieldRetiredKey,
} from './field-types.js';
// objectui#11610 — the `grid` field's retired snake_case field-level keys, each
// mapped to its camelCase replacement: the one list the form-field zod mirror's
// alias refusals and the `grid` widget's named refusal both read.
export { GRID_FIELD_RETIRED_KEYS } from './field-types.js';

// System / audit / ownership field classification — runtime helper + name set,
// used by default list-column derivation to keep framework-injected fields
// (notably `owner_id`) out of the leading business columns.
export {
  SYSTEM_MANAGED_FIELD_NAMES,
  AUDIT_FIELD_BY_ROLE,
  AUDIT_FIELD_NAMES,
  isSystemManagedField,
} from './system-fields.js';
export type { AuditFieldName } from './system-fields.js';
export { MANAGED_BY_BUCKETS } from './managed-by.js';
export type { ManagedByBucket } from './managed-by.js';

// ============================================================================
// Phase 3: Data Protocol Advanced Types
// ============================================================================
export type {
  // Query AST (Phase 3.3)
  QueryASTNodeType,
  QueryASTNode,
  SelectNode,
  FromNode,
  WhereNode,
  JoinNode,
  JoinStrategy,
  GroupByClauseNode,
  OrderByNode,
  LimitNode,
  OffsetNode,
  SubqueryNode,
  AggregateNode,
  WindowNode,
  WindowFunction,
  WindowFrame,
  WindowFrameUnit,
  WindowFrameBoundary,
  FieldNode,
  LiteralNode,
  OperatorNode,
  FunctionNode,
  ComparisonOperator,
  LogicalOperator,
  SqlQueryAST,
  DriverQueryConfig,
  QuerySortConfig,
  JoinConfig,
  AggregationConfig,
  WindowConfig,
  // Filter Schema (Phase 3.4)
  AdvancedFilterSchema,
  AdvancedFilterCondition,
  AdvancedFilterOperator,
  DateRangeFilter,
  // Renamed from `DateRangePreset` in objectui#4167 — the spec owns that name
  // for the narrower dashboard filter-bar vocabulary (objectstack#4115).
  FilterBuilderDateRangePreset,
  FilterBuilderConfig,
  FilterFieldConfig,
  // Object-level validation rules. The five spec-named variants are derived from
  // `@objectstack/spec/data`; the other three are @deprecated objectui-local
  // variants the spec's union rejects. See data-protocol.ts.
  BaseValidation,
  ScriptValidation,
  UniquenessValidation,
  StateMachineValidation,
  CrossFieldValidation,
  AsyncValidation,
  ConditionalValidation,
  FormatValidation,
  RangeValidation,
  ObjectValidationRule,
  // Driver Interface (Phase 3.6)
  SqlDriverInterface,
  ConnectionConfig,
  DriverQueryResult,
  BatchOperation,
  BatchResult,
  TransactionContext,
  CacheManager,
  ConnectionPool,
  // Datasource Schema (Phase 3.7)
  DatasourceRegistration,
  DatasourceType,
  DatasourceMetric,
  DatasourceAlert,
  DatasourceManager,
  HealthCheckResult,
  DatasourceMetrics,
} from './data-protocol.js';

// ============================================================================
// Permission & RBAC Types (Q2 2026)
// ============================================================================
export type {
  PermissionAction,
  PermissionEffect,
  RoleDefinition,
  FieldLevelPermission,
  RowLevelPermission,
  PermissionCondition,
  ObjectPermissionConfig,
  SharingRuleConfig,
  PermissionCheckResult,
  PermissionContext,
  // `PermissionGuardConfig` RETIRED outright by objectui#8024 — see the
  // RETIRED note in `./permissions`; the guard reads `PermissionGuardProps`.
} from './permissions.js';

// ============================================================================
// Mobile Optimization Types (Q2 2026)
// ============================================================================
export type {
  BreakpointName,
  ResponsiveValue,
  // `MobileResponsiveConfig` RETIRED outright by objectui#7519 — see the
  // RETIRED note in `./mobile`; its only consumer went with objectui#5942.
  PWAConfig,
  PWAIcon,
  FetchCacheStrategy,
  PWAOfflineConfig,
  OfflineRoute,
  // `GestureType` reclaimed its natural name in objectui#3363 once
  // `@objectstack/spec` deleted `ui/touch` (objectstack#4988); `GestureConfig`
  // took the same road and was then RETIRED outright by objectui#7519 — see
  // the RETIRED note in `./mobile`. `PWAOfflineConfig` above deliberately did
  // NOT reclaim — see its note in `./mobile`; `@object-ui/react`'s `useOffline`
  // owns that name.
  GestureType,
  GestureContext,
  // The retired `@objectstack/spec/ui` touch vocabulary, now owned here —
  // see the "Spec Touch Vocabulary" note in `./mobile` (objectstack#4988).
  // `SPEC_GESTURE_TYPES` is its runtime witness and is exported as a VALUE
  // below, outside this `export type` block.
  SpecGestureType,
  SpecSwipeDirection,
  SpecGestureConfig,
  SwipeGestureConfig,
  PinchGestureConfig,
  LongPressGestureConfig,
  TouchTargetConfig,
  TouchInteraction,
} from './mobile.js';

// Runtime witness for the retired touch vocabulary — a VALUE, so it must not
// sit inside the `export type` block above (#2561: inside one it is
// value-erased and resolves to `undefined` at runtime).
export { SPEC_GESTURE_TYPES } from './mobile.js';

// ============================================================================
// Visual Designer Types (Q2 2026)
// ============================================================================
export type {
  DesignerPosition,
  DesignerCanvasConfig,
  DesignerComponent,
  PageDesignerSchema,
  DesignerPaletteCategory,
  DesignerPaletteItem,
  DataModelEntity,
  DataModelField,
  DataModelRelationship,
  DataModelDesignerSchema,
  BPMNNodeType,
  BPMNNode,
  BPMNEdge,
  BPMNLane,
  ProcessDesignerSchema,
  ReportSectionType,
  ReportDesignerElement,
  ReportDesignerSection,
  ReportDesignerSchema,
  CollaborationPresence,
  CollaborationOperation,
  CollaborationConfig,
  ViewColumnConfig,
  UnifiedViewType,
  UnifiedViewConfig,
  DashboardColorVariant,
  DashboardWidgetType,
  DashboardWidgetConfig,
  DashboardConfig,
  ObjectDefinition,
  ObjectManagerSchema,
  DesignerFieldType,
  DesignerFieldOption,
  DesignerFieldDefinition,
  FieldDesignerSchema,
} from './designer.js';

export {
  DASHBOARD_COLOR_VARIANTS,
  DASHBOARD_WIDGET_TYPES,
  DESIGNER_FIELD_TYPES,
} from './designer.js';

// Retired-field-key tombstone registry (objectui#6527) is DELIBERATELY not
// re-exported from this main barrel — ruled objectui#6527 option B
// (maintainer, 2026-08-28). It lives at the dedicated internal subpath
// `@object-ui/types/internal/retired-field-keys` instead: importing this
// barrel eagerly evaluates every other module it re-exports (including
// `spec-report.ts`'s read of `@objectstack/spec/ui`), and a registry export
// added here widened that evaluation graph enough to break an unrelated
// consumer's partial spec mock. A subpath import never pulls this barrel in.
// See `packages/types/src/internal/retired-field-keys.ts` for the registry.

// ============================================================================
// API and Events - API Integration and Event Handling
// ============================================================================
export type {
  HTTPMethod,
  APIRequest,
  APIConfig,
  // `UIEventHandler` and `EventableSchema` are GONE from this block, not
  // emptied out of it: both were RETIRED in objectui#6497 (ADR-0049
  // enforce-or-remove, director ruling of 2026-09-24, maintainer verbatim
  // 「同意」). Declared, unmirrored, unextended and unread, they only invited a
  // handler dialect no runtime dispatches. The supported form is the
  // declarative `ActionDef` object from `@object-ui/core`; the reasoning is the
  // tombstone in `./api-types.ts`.
  DataFetchConfig,
  DataFetchableSchema,
  ExpressionContext,
  ExpressionNodeSchema,
  APISchema,
} from './api-types.js';

// ============================================================================
// Union Types - Discriminated Unions for All Schemas
// ============================================================================

import type { BaseSchema, SchemaNode } from './base.js';
import type { LayoutSchema, PageNodeSchema } from './layout.js';
import type { FormComponentSchema } from './form.js';
import type { DataDisplaySchema } from './data-display.js';
import type { FeedbackSchema } from './feedback.js';
import type { DisclosureSchema } from './disclosure.js';
import type { OverlaySchema } from './overlay.js';
import type { NavigationSchema } from './navigation.js';
import type {
  ComplexSchema,
  DashboardComponentSchema,
  DashboardWidgetSlotComponentSchema,
} from './complex.js';
import type { CRUDComponentSchema } from './crud.js';
import type { ObjectQLComponentSchema, ListViewSchema } from './objectql.js';
import type { AppComponentSchema, AppSchemaRendererNodeSchema } from './app.js';
import type { CloudWorkspaceTimezoneNoticeSchema } from './cloud.js';
import type {
  HeroBlockSchema,
  StatBlockSchema,
  UsageBarBlockSchema,
  ChecklistBlockSchema,
  TileGridBlockSchema,
} from './product-blocks.js';
import type { RecordApprovalDecisionBlockSchema } from './record-approval-decision.js';
import type { RecordApprovalsBlockSchema, RecordAttachmentsBlockSchema } from './record-panels.js';
import type {
  PageDesignerSchema,
  DataModelDesignerSchema,
  ProcessDesignerSchema,
  ReportDesignerSchema,
  ObjectManagerSchema,
  FieldDesignerSchema,
} from './designer.js';
import type { ReportComponentSchema, ReportBuilderSchema, ReportViewerSchema } from './reports.js';
import type { AIFormAssistSchema, AIRecommendationsSchema, NLQuerySchema } from './ai.js';
import type { ViewComponentSchema } from './views.js';
import type { ActionBarSchema } from './ui-action.js';

// ============================================================================
// Phase 2 Schemas - New Additions
// ============================================================================
export type {
  // Theme System — the document vocabulary is owned HERE since objectui#5716
  // (maintainer ruling 2026-08-23, option A — localize): the spec retired its
  // theme module (objectstack `35ad101bc`) while objectui RETAINED the theme system,
  // so the types moved into `./theme` with the last-published 17.1.0 shapes as
  // the blueprint. `Typography` / `BorderRadius` / `Shadow` /
  // `ThemeDefinition` were DELETED under the same ruling's zero-reader rider
  // (the first three live on as inline members of `Theme`).
  Theme,
  // `ThemeComponentSchema` RETIRED in `78cbdb530` — the `type: 'theme'`
  // component kind no renderer implemented. See `./theme` for the tombstone.
  ThemeMode,
  ColorPalette,
  // `Animation` / `ZIndex` retired with `theme.animation` / `theme.zIndex` in
  // @objectstack/spec 17.0.0-rc.3 (objectstack#5021) — see `./theme`.
  // `ThemeSwitcherSchema` / `ThemePreviewSchema` RETIRED in objectui#5647 —
  // the `type: 'theme-switcher'` / `'theme-preview'` component kinds no
  // renderer implemented; same shape, same inherited ruling as
  // `ThemeComponentSchema` above. See `./theme` for the tombstone.
} from './theme.js';

// Runtime witness for the theme mode vocabulary — a VALUE, so it must not sit
// inside the `export type` block above (#2561: inside one it is value-erased
// and resolves to `undefined` at runtime). Same pattern as
// `SPEC_GESTURE_TYPES` below.
export { THEME_MODES } from './theme.js';

export type {
  // Report Presentation Layer (ObjectUI-specific UX enhancements:
  // sections, schedule, export presets, conditional formatting, etc.).
  // For the protocol-level Report definition, use `Spec*` exports below.
  ReportComponentSchema,
  ReportType,
  ReportExportFormat,
  ReportScheduleFrequency,
  ReportAggregationType,
  ReportField,
  ReportFilter,
  ReportGroupBy,
  ReportSection,
  ReportScheduleConfig,
  ReportExportConfig,
  ReportBuilderSchema,
  ReportViewerSchema,
} from './reports.js';

// ---------------------------------------------------------------------------
// Spec Report Bridge
//
// Authoritative report protocol from @objectstack/spec, re-exported under
// `Spec*` names so they coexist with the legacy presentation `ReportComponentSchema`.
// See `./spec-report.ts` for the layering rationale.
// ---------------------------------------------------------------------------
export type {
  SpecReportInput,
  SpecReportChart,
  SpecReportChartInput,
  SpecReportTypeName,
  SpecReportAggregate,
  SpecReportDateGranularity,
  QLAggregationFunction,
  LegacyReportPresentationLike,
  JoinedReportBlock,
  JoinedSpecReport,
} from './spec-report.js';

export {
  SpecReportSchema,
  SpecReportChartSchema,
  SpecReportTypeEnum,
  SpecReport,
  mapAggregateToQL,
  specReportToPresentation,
  isSpecReport,
  isJoinedSpecReport,
} from './spec-report.js';

// Workflow / Flow Designer schemas removed in 9.0 — they backed the retired
// `@object-ui/plugin-workflow` designers, whose BPMN-style node vocabulary the
// ObjectStack automation engine does not execute (ADR-0020, ADR-0031). The
// supported flow designer is the Studio's metadata-admin FlowCanvas in
// `@object-ui/app-shell`, which models nodes/edges locally against the
// `@objectstack/spec` flow schema.

export type {
  // AI System
  AIProvider,
  AIModelType,
  AIConfig,
  AIFieldSuggestion,
  AIFormAssistSchema,
  AIRecommendationItem,
  AIRecommendationsSchema,
  NLQueryResult,
  NLQuerySchema,
  // `AIInsightsSchema` is GONE from this block, not emptied out of it:
  // `type: 'ai-insights'` was RETIRED whole in objectui#8800 (ADR-0049
  // enforce-or-remove, director ruling of 2026-09-15, decision batch #137
  // item 2, maintainer verbatim 「同意」, letter A). Nothing ever registered
  // the discriminant, so the declaration could only ever route an author to a
  // node that type-checks and then renders the OBJUI-001 panel. The reasoning,
  // the boundary against the three AI schemas that DO render, and the in-repo
  // limit on its census live at the tombstone in `./ai.ts`; the executable half
  // is `./__tests__/ai-insights-retired-8800.test.ts`.
} from './ai.js';

export type {
  // Cloud widgets — the `cloud:workspace-timezone-notice` node's TS twin
  // (objectui#11930).
  CloudWorkspaceTimezoneNoticeSchema,
} from './cloud.js';

export type {
  // The product-page blocks' TS twins, landed with their zod arms and their
  // `@object-ui/app-shell` registrations (objectui#12197).
  ProductBlockExpressionHole,
  HeroBlockProps,
  HeroBlockSchema,
  StatBlockProps,
  StatBlockSchema,
  UsageBarBlockProps,
  UsageBarBlockSchema,
  ChecklistBlockItem,
  ChecklistBlockProps,
  ChecklistBlockSchema,
  TileGridBlockItem,
  TileGridBlockAddTile,
  TileGridBlockProps,
  TileGridBlockSchema,
} from './product-blocks.js';

export type {
  // The `record:approval_decision` node's TS twin, landed with its zod arm
  // and its `@object-ui/app-shell` registration (objectui#12342).
  RecordApprovalDecisionBlockSchema,
} from './record-approval-decision.js';

export type {
  // The `record:approvals` / `record:attachments` nodes' TS twins, landed with
  // their zod arms (objectui#12363).
  RecordApprovalsBlockSchema,
  RecordAttachmentsBlockSchema,
} from './record-panels.js';

// The Block System re-export block is GONE, not emptied: `BlockSchema`,
// `BlockMetadata`, `BlockVariable`, `BlockSlot`, `BlockLibraryItem`,
// `BlockLibrarySchema`, `BlockEditorSchema`, `BlockInstanceSchema` and
// `ComponentSchema` were RETIRED whole in objectui#4895 (ADR-0049
// enforce-or-remove, maintainer ruling 2026-09-02, option C1). `./blocks.ts`
// is kept as the tombstone and carries the reasoning, the evidence and the
// boundary against the live slotted record-page vocabulary in `./layout.ts`.

export type {
  // View System Enhancements
  ViewType,
  // Host-composition config for the `tree` view type (objectui#8253). The
  // ONE declaration of the block `ObjectViewProps.views[n].tree` carries;
  // `plugin-tree` imports it instead of re-deriving a module-local copy.
  TreeViewConfig,
  DetailViewSchema,
  DetailViewField,
  DetailViewSection,
  DetailViewTab,
  SectionGroup,
  HighlightField,
  ViewSwitcherSchema,
  FilterUISchema,
  SortUISchema,
  // The `detail-section` node's TS twin (objectui#11515).
  DetailSectionNodeSchema,
  ViewComponentSchema,
  CommentEntry,
  MentionNotification,
  CommentSearchResult,
  ActivityEntry,
  // Feed / Chatter Protocol Types
  FeedItemType,
  FeedItem,
  FieldChangeEntry,
  Mention,
  Reaction,
  RecordSubscription,
} from './views.js';

export type {
  // Enhanced Action System (Phase 2)
  ActionExecutionMode,
} from './crud.js';

/**
 * Union of all component schemas.
 * Use this for generic component rendering where the type is determined at runtime.
 *
 * "All" is re-derived by a test, not stated here (objectui#11478):
 * `./__tests__/anyschema-declared-node-types-11478.test.ts` enumerates every
 * object type this package publishes whose `extends` chain reaches
 * `BaseSchema` and whose `type` is a string literal, and fails naming each one
 * that is not a member. The same file checks that `SchemaByType` resolves
 * every single-literal member to itself. `ActionBarSchema` is a node type that
 * does not extend `BaseSchema`, so the enumeration cannot see it; that file
 * holds it by name, and nothing finds the next node type of its kind.
 *
 * The `BaseSchema` arm admits any `type` string, so membership here decides
 * what `SchemaByType` and narrowing on `type` return. The spec-row authoring
 * faces are a separate list, `AuthoringNode`, and are not members.
 */
export type AnySchema =
  | AppComponentSchema
  | BaseSchema
  | LayoutSchema
  | PageNodeSchema
  | FormComponentSchema
  | DataDisplaySchema
  | FeedbackSchema
  | DisclosureSchema
  | OverlaySchema
  | NavigationSchema
  | ComplexSchema
  | DashboardComponentSchema
  | DashboardWidgetSlotComponentSchema
  | CRUDComponentSchema
  | ObjectQLComponentSchema
  | ListViewSchema
  | PageDesignerSchema
  | DataModelDesignerSchema
  | ProcessDesignerSchema
  | ReportDesignerSchema
  | ObjectManagerSchema
  | FieldDesignerSchema
  | ReportComponentSchema
  | ReportBuilderSchema
  | ReportViewerSchema
  | AIFormAssistSchema
  | AIRecommendationsSchema
  | NLQuerySchema
  | ViewComponentSchema
  | ActionBarSchema
  // objectui#11515 — the TS twin of a zod-only arm; its sibling
  // `DetailSectionNodeSchema` is a member through `ViewComponentSchema`. The
  // third, `cloud:plan-status`, retired with its widget (objectui#12954).
  | AppSchemaRendererNodeSchema
  // objectui#11930 — landed with its zod arm.
  | CloudWorkspaceTimezoneNoticeSchema
  // objectui#12342 — landed with its zod arm.
  | RecordApprovalDecisionBlockSchema
  // objectui#12363 — landed with their zod arms.
  | RecordApprovalsBlockSchema
  | RecordAttachmentsBlockSchema
  // objectui#12197 — landed with their zod arms.
  | HeroBlockSchema
  | StatBlockSchema
  | UsageBarBlockSchema
  | ChecklistBlockSchema
  | TileGridBlockSchema;

/**
 * Utility type to extract the schema type from a type string.
 * Useful for type narrowing in renderers.
 * 
 * @example
 * ```typescript
 * function renderComponent<T extends string>(schema: SchemaByType<T>) {
 *   // schema is now typed based on the type string
 * }
 * ```
 */
export type SchemaByType<T extends string> = Extract<AnySchema, { type: T }>;

/**
 * Schema with required children (for container components).
 */
export type ContainerSchemaWithChildren = BaseSchema & {
  children: SchemaNode | SchemaNode[];
};

/**
 * Version information
 */
export const VERSION = '0.1.0';

/**
 * Schema version for compatibility checking
 */
export const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Schema Registry - The Type Map
// ============================================================================
export type {
  SchemaRegistry,
  ComponentType,
} from './registry.js';

// ============================================================================
// Plugin Scope Isolation - Section 3.3
// ============================================================================
export type {
  PluginScope,
  PluginScopeConfig,
  AppPluginContext,
  AppMetadataPlugin,
  /**
   * @deprecated Use `ComponentMeta` instead. Since objectui#5893 converged the
   * plugin-scoped declaration onto `base.ts`, this alias names the SAME type
   * under a second name — it carries no information `ComponentMeta` does not.
   * Before that convergence it named a genuinely different nine-key interface,
   * which is why it is deprecated only now and not alongside
   * `PluginComponentInput`: deprecating it earlier would have warned about a
   * name that was still about to change meaning. Retirement follows
   * objectui#5674's two-stage pattern (maintainer ruling, 2026-08-22:
   * deprecate for a release, then remove). This deprecation window exists for
   * consumers outside this repository, which cannot be measured from here;
   * in-repo the name has zero importers. Removal ships as a `minor` under this
   * repo's version policy (objectui's own breaking changes never declare
   * `major`).
   */
  ComponentMeta as PluginComponentMeta,
  PluginEventHandler,
} from './plugin-scope.js';

// ============================================================================
// UI Actions - Enhanced Action Schema (ObjectStack Spec v2.0.1)
// ============================================================================
/**
 * Enhanced action schema with location-based placement, parameter collection,
 * conditional visibility, and rich feedback mechanisms.
 */
export type {
  ActionLocation,
  ActionComponent,
  ActionType,
  ObjectUiLocalActionType,
  RunnableActionType,
  ActionParamFieldType,
  ObjectUiLocalParamFieldType,
  ResolvableParamFieldType,
  ActionParam,
  UIActionSchema,
  ActionBarSchema,
  DeclaredActionsRefusal,
  DeclaredActionsResolution,
  ActionContext,
  ActionResult,
  // The `undo` payload of `ActionResult`, moved down from `@object-ui/core`'s
  // `UndoManager` with it (objectui#6349, batch 4); core re-exports it.
  UndoableOperation,
  ActionExecutor,
  BatchOperationConfig,
  BatchOperationSummary,
  TransactionIsolationLevel,
  TransactionConfig,
  TransactionResult,
  // `UndoRedoEntry` / `UndoRedoConfig` / `UndoRedoState` were retired here
  // (objectui#6349, batch 5) — see the note at the end of `ui-action.ts`.
} from './ui-action.js';

export {
  ACTION_LOCATIONS,
  ActionLocationSchema,
  OBJECTUI_LOCAL_ACTION_TYPES,
  OBJECTUI_LOCAL_PARAM_FIELD_TYPES,
  ACTION_PARAM_FIELD_TYPES,
  actionRendersAt,
  resolveDeclaredActionIds,
} from './ui-action.js';

// ============================================================================
// ObjectStack Protocol Namespaces - Protocol Re-exports
// ============================================================================
/**
 * Re-export ObjectStack Protocol namespaces for convenience.
 * 
 * This allows consumers to access the full ObjectStack protocol through
 * @object-ui/types without needing to install @objectstack/spec separately.
 * 
 * @example
 * ```typescript
 * import { Data, UI, System, AI, API, Kernel } from '@object-ui/types';
 * 
 * const field: Data.Field = { name: 'task_name', type: 'text' };
 * const view: UI.ListView = { name: 'all', label: 'All Records', ... };
 * ```
 */
export type * as Data from '@objectstack/spec/data';
// Deliberate public namespace export of the spec vocabulary — via the local
// shim module since objectui#5716, so the `UI.Theme`-family members are
// re-pointed at their owner (`./theme.ts`) and survive the spec's theme
// retirement instead of narrowing silently on the pin refresh. See the shim's
// header for the full reasoning. The objectstack-ai/objectstack#4171 caveat still applies:
// `UI.FormField` erases to `any` until the spec types its unions.
export type * as UI from './spec-ui-namespace.js';
export type * as System from '@objectstack/spec/system';
export type * as AI from '@objectstack/spec/ai';
export type * as API from '@objectstack/spec/api';
// `Cloud` is deliberately absent from this family since objectui#8225: the
// cloud control-plane contracts leave the spec's public surface (objectstack#16325,
// option B), so nothing here re-exports that subpath and no consumer reads it.
export type * as Automation from '@objectstack/spec/automation';
export type * as Shared from '@objectstack/spec/shared';
export type * as QA from '@objectstack/spec/qa';
export type * as Kernel from '@objectstack/spec/kernel';
export type * as Contracts from '@objectstack/spec/contracts';
export type * as Integration from '@objectstack/spec/integration';
export type * as Studio from '@objectstack/spec/studio';
export type * as Identity from '@objectstack/spec/identity';
export type * as Security from '@objectstack/spec/security';

// ============================================================================
// ObjectStack Protocol Utilities - defineStack
// ============================================================================
/**
 * Re-export ObjectStack Protocol utility functions and top-level types.
 *
 * @example
 * ```typescript
 * import { defineStack } from '@object-ui/types';
 *
 * export default defineStack({
 *   manifest: { id: 'com.example.app', version: '1.0.0', type: 'app', name: 'My App' },
 *   objects: [],
 *   apps: [],
 * });
 * ```
 */
export {
  defineStack,
  ObjectStackSchema,
  ObjectStackDefinitionSchema,
} from '@objectstack/spec';

export type {
  PluginContext,
  ObjectStack,
  ObjectStackDefinition,
} from '@objectstack/spec';

// ----------------------------------------------------------------------------
// NOTE (#2561): the `@objectstack/spec/ui` blocks below re-export the inferred
// *types* only. The companion zod validators (`…Schema`) are deliberately NOT
// re-exported: inside `export type { … }` they were value-erased, so importing
// one as a value from `@object-ui/types` silently yielded `undefined` at
// runtime. Consumers that need the runtime validators must import them from
// `@objectstack/spec/ui` directly. Guardrail:
// `src/__tests__/spec-ui-schema-reexports.test.ts`.
// ----------------------------------------------------------------------------

// ============================================================================
// v2.0.7 Spec UI Types — Drag and Drop / Focus & Keyboard / Animation & Motion
// ============================================================================
// RETIRED in @objectstack/spec 17.0.0-rc.3 (objectstack#4988, PR objectstack#5321):
// the five `ui/` interaction-config modules (touch / dnd / keyboard / animation /
// offline) were deleted whole — 32 defs, 64 exports. None of these blocks had an
// authoring door: no metadata document could ever carry one, so a stack that
// parsed before the retirement parses byte-for-byte the same after it, and the
// re-exports below were type-only surface with no runtime half to lose.
//
// The `DndConfig` / `KeyboardShortcut` names still live in this repo as LOCAL
// declarations in `@object-ui/core`'s `DndProtocol.ts` / `KeyboardProtocol.ts`.
// Those never imported the spec — the collision is a naming coincidence, not a
// coupling, and they are deliberately untouched (objectui#3363).

// ============================================================================
// v2.0.7 Spec UI Types — Notifications
// ============================================================================
/**
 * The PRESENTATION vocabulary only. `@objectstack/spec/ui` dropped the two
 * composite notification types in 17.0.0 (objectstack#4610): `Notification`
 * (a toast/banner instance shape) and `NotificationConfig` (a toaster global
 * config). Neither has a successor anywhere in the spec.
 *
 * Do NOT re-point `Notification` at `@objectstack/spec/api`. That name now has
 * exactly one owner, and it is a DIFFERENT contract — the REST inbox row
 * (`id` / `type` / `title` / `body` / `read` / `data` / `actionUrl` /
 * `createdAt`), with none of `severity` / `duration` / `dismissible` /
 * `actions` / `position`. Same name, different shape: aliasing it here would
 * re-create the very dual-source trap objectstack-ai/objectstack#4610 closed.
 *
 * The live objectui equivalent of the removed config is
 * `NotificationSystemConfig` in `@object-ui/react`'s `NotificationContext`,
 * which is declared locally and is what every surface actually reads.
 *
 * `NotificationAction` left the same way in 17.0.0-rc.3 (objectstack#5015, PR
 * objectstack#5300): no notification action was ever parsed from metadata, so
 * nothing regressed at runtime. The three PRESENTATION enums below survive and
 * are the toaster vocabulary this repo actually reads.
 */
export type {
  NotificationPosition,
  NotificationSeverity,
  NotificationType,
} from '@objectstack/spec/ui';

// ============================================================================
// v2.0.7 Spec UI Types — Gestures & Touch / Offline & Sync
// ============================================================================
// RETIRED with the same objectstack#4988 / PR objectstack#5321 deletion as the
// interaction blocks above. `@object-ui/react`'s `useOffline` is the real owner
// of the offline semantics and now declares its own types locally, which is the
// remediation the spec's own retirement ledger prescribes for a client that
// consumed these as types: "it is your client's policy, not the platform's".
//
// Note `@objectstack/spec/integration`'s `ConnectorConflictResolution` and
// `@objectstack/spec/api`'s `ConflictResolutionStrategy` are DIFFERENT concepts
// and are untouched — do not re-point the deleted `ConflictResolution` at them.

// ============================================================================
// v2.0.7 Spec UI Types — View Enhancements
// ============================================================================
export type {
  ColumnSummary,
  GalleryConfig,
  GroupingConfig,
  RowColorConfig,
  RowHeight,
  TimelineConfig,
  NavigationConfig,
  ViewSharing,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — Dashboard (P1.3)
// ============================================================================
export type {
  Dashboard as SpecDashboard,
  DashboardWidget as SpecDashboardWidget,
  DashboardHeader as SpecDashboardHeader,
  DashboardHeaderAction as SpecDashboardHeaderAction,
  GlobalFilter as SpecGlobalFilter,
  GlobalFilterOptionsFrom,
  // WidgetMeasure / WidgetMeasureSchema removed in @objectstack/spec 9.0
  // (ADR-0021 single-form cutover) — dashboard widgets are dataset-bound now.
  WidgetColorVariant,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — Sharing & Embedding (P2.3)
// ============================================================================
// `EmbedConfig` RETIRED in 17.0.0-rc.3 (objectstack#5015, PR objectstack#5300):
// no iframe route ever read an embed config, so nothing ran to regress.
// `SharingConfig` is the SURVIVOR and stays — public form sharing is unaffected,
// `FormView.sharing` still gates the anonymous endpoints on `allowAnonymous` +
// `publicLink`.
export type { SharingConfig } from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — View Configuration (P2.4)
// ============================================================================
export type {
  AddRecordConfig,
  AppearanceConfig,
  UserActionsConfig,
  ViewTab,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.10 Spec UI Types — View Filter Rules
// ============================================================================
export type {
  ViewFilterRule,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — Form View (P1.2)
// ============================================================================
// Deliberate public aliases (the `Spec` prefix IS the disambiguation the
// #3090 tripwire exists to force). objectstack-ai/objectstack#4171 caveat: SpecFormField is `any` today.
/* eslint-disable no-restricted-imports -- reported at the specifier line, out of -next-line reach */
export type {
  FormView as SpecFormView,
  FormSection as SpecFormSection,
  FormField as SpecFormField,
} from '@objectstack/spec/ui';
/* eslint-enable no-restricted-imports */

// ============================================================================
// v3.0.8 Spec UI Types — ListView (P1.1)
// ============================================================================
export type {
  ListView as SpecListView,
  ListColumn as SpecListColumn,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — Record Components (P1.5)
// ============================================================================
export type {
  RecordDetailsProps as SpecRecordDetailsProps,
  RecordHighlightsProps as SpecRecordHighlightsProps,
  RecordRelatedListProps as SpecRecordRelatedListProps,
  RecordActivityProps as SpecRecordActivityProps,
  RecordChatterProps as SpecRecordChatterProps,
  RecordPathProps as SpecRecordPathProps,
} from '@objectstack/spec/ui';

// ============================================================================
// v3.0.8 Spec UI Types — Page (P1.4)
// ============================================================================
export type {
  Page as SpecPage,
  PageComponent as SpecPageComponent,
  PageRegion as SpecPageRegion,
  PageType as SpecPageType,
  PageVariable as SpecPageVariable,
  // BlankPageLayout{,Schema,Item,ItemSchema} dropped — `blank` page type has no
  // renderer; removed from @objectstack/spec PageTypeSchema (framework#2265).
} from '@objectstack/spec/ui';

// ============================================================================
// v2.0.7 Spec UI Types — Performance & Page Transitions
// ============================================================================
// `PerformanceConfig` was RETIRED here with `dashboard.performance` in spec
// 17.0.0 (framework#3896 audit close-out): no renderer or runtime ever read the
// key, and its value schema had no other consumer, so it went with it. Nothing
// in this repo bound to the spec type — `@object-ui/react`'s `usePerformance`
// declares its own `PerformanceConfig` interface and is untouched.
//
// `PageTransition` went the same way one rc later, as part of the `ui/animation`
// module deletion (objectstack#4988, PR objectstack#5321).
export type { PageComponentType } from '@objectstack/spec/ui';

// ============================================================================
// v2.0.7 Spec UI Types — Accessibility
// ============================================================================
export type {
  AriaProps,
} from '@objectstack/spec/ui';

// ============================================================================
// v2.0.7 Spec UI Types — I18n
// ============================================================================
// `I18nObject`, `LocaleConfig`, `PluralRule`, `DateFormat` and `NumberFormat`
// (and their `…Schema` values) were retired from `@objectstack/spec/ui` in
// 17.0.0-rc.6. Nothing in this repo imported them from here — the only names
// that looked like consumers are `Intl.NumberFormat` call sites and
// `@object-ui/i18n`'s own locally declared formatter vocabulary in
// `utils/spec-formatters.ts`, which never bound the spec symbols. So these five
// were dead re-exports and are dropped rather than re-declared locally.
// `I18nLabel` SURVIVES rc.6 and stays bound by reference: it is the authoring
// label union (`string | Record<string, string>`) that `ActionParam.label` and
// friends are typed against, and rc.6 additionally publishes the inline-map
// half as `InlineLocaleMap` plus the shared `resolveI18nLabel` resolver.
export type {
  I18nLabel,
} from '@objectstack/spec/ui';

// ============================================================================
// v2.0.7 Spec UI Types — Responsive Design: RETIRED UPSTREAM, dropped here
// ============================================================================
// `SpecResponsiveConfig` (the spec's `ResponsiveConfig`) and
// `SpecBreakpointName` (its `BreakpointName`) were re-exported from this
// block under deliberately prefixed names. objectstack#11027 retired the whole
// `ui/responsive` vocabulary, and objectui#7580 removed the only two things in
// this repo that read the prefixed pair: `@object-ui/core`'s
// `ResponsiveProtocol` and `@object-ui/mobile`'s `useResponsiveConfig`, both
// measured at zero callers. So both rows are DEAD re-exports and are dropped
// rather than re-declared locally — the same disposition, for the same reason,
// as the five retired i18n names in the block above.
//
// The layout vocabulary itself is NOT dropped: `BreakpointName` is declared
// locally in `./mobile.ts` and re-exported unprefixed from the Mobile block
// above, and `BreakpointColumnMap` in `@object-ui/layout`'s
// `ResponsiveGrid.tsx` — both because a renderer implements them, which is the
// tombstone's own stated return condition: `BreakpointName` is the key set of
// the `grid` node's authorable breakpoint `columns`, and `BreakpointColumnMap`
// types `ResponsiveGrid`'s `columns` prop. (The ground used to be the
// `responsive-grid` node; objectui#11441 retired that registration under the
// maintainer's ruling `5950208338` and kept both declarations.)

// ============================================================================
// Widget System - Runtime Widget Registration (Section 1.6)
// ============================================================================
/**
 * Widget manifest and registry types for runtime widget registration,
 * plugin auto-discovery, and custom widget registry.
 */
export type {
  RuntimeWidgetManifest,
  RuntimeWidgetSource,
  WidgetSourceModule,
  WidgetSourceInline,
  WidgetSourceRegistry,
  WidgetInput,
  WidgetCapabilities,
  ResolvedWidget,
  WidgetRegistryEvent,
  WidgetRegistryListener,
} from './widget.js';

export { errorCodeIs, errorCodeIsAnyOf } from './error-code.js';

// Transient-HTTP-retry primitives, shared by the two `/auth/me/*` providers
// (permissions is fail-closed and blocks across the waits, localization is
// cosmetic and never blocks) so "what counts as transient" has ONE definition.
export {
    MAX_RETRY_DELAY_MS,
    TRANSIENT_STATUS,
    HttpFetchError,
    isTransientFailure,
    parseRetryAfterMs,
    backoffMs,
    sleep,
    retryAfterFrom,
} from './http-retry.js';

// In-flight sharing for identical GETs (objectui#5544). Same argument for the
// same home: the callers that overlap — the pre-React branding script, app-shell's
// runtime config, the language seed and the localization provider — have no
// package in common lower than this one. Shares the PROMISE only; the entry is
// gone the moment the request settles, so nothing here is a cache.
export {
    INFLIGHT_GET_REGISTRY_KEY,
    inflightGetKey,
    sharedGetJson,
    resetInflightGetsForTesting,
} from './http-inflight.js';
