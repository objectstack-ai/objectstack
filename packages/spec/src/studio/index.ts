// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module studio
 * 
 * Studio Protocol — Plugin system for ObjectStack Studio
 * 
 * Defines the extension model that allows metadata types to contribute
 * custom viewers, designers, sidebar groups, actions, and commands.
 * Also includes the Object Designer protocol for visual field editing,
 * relationship mapping, and ER diagram configuration.
 */

export {
  // Schemas
  ViewModeSchema,
  MetadataViewerContributionSchema,
  SidebarGroupContributionSchema,
  ActionContributionSchema,
  // [#4737] Renamed from `ActionLocationSchema` — that bare name now belongs
  // solely to `@objectstack/spec/ui`'s 7-value app-UI vocabulary. This is the
  // 3-value Studio IDE surface enum for `ActionContributionSchema.location`.
  ActionContributionLocationSchema,
  MetadataIconContributionSchema,
  PanelContributionSchema,
  PanelLocationSchema,
  CommandContributionSchema,
  StudioPluginContributionsSchema,
  // [#4657] `ActivationEventSchema` / `ActivationEvent` are REMOVED (ADR-0049
  // enforce-or-remove): no runtime ever read an activation event — every
  // plugin activates immediately — so the vocabulary was retired with the
  // `activationEvents` keys that embedded it. Do not re-export a substitute
  // under these names; the removal is pinned by
  // kernel/activation-events-retirement.test.ts.
  StudioPluginManifestSchema,

  // Types
  type ViewMode,
  type MetadataViewerContribution,
  type SidebarGroupContribution,
  type ActionContribution,
  type ActionContributionLocation,
  type MetadataIconContribution,
  type PanelContribution,
  type PanelLocation,
  type CommandContribution,
  type StudioPluginContributions,
  type StudioPluginManifest,

  // Helpers
  defineStudioPlugin,
} from './plugin.zod';

export {
  // Object Designer Schemas
  FieldPropertySectionSchema,
  FieldGroupSchema,
  FieldEditorConfigSchema,
  RelationshipDisplaySchema,
  RelationshipMapperConfigSchema,
  ERLayoutAlgorithmSchema,
  ERNodeDisplaySchema,
  ERDiagramConfigSchema,
  ObjectListDisplayModeSchema,
  ObjectSortFieldSchema,
  ObjectFilterSchema,
  ObjectManagerConfigSchema,
  ObjectPreviewTabSchema,
  ObjectPreviewConfigSchema,
  ObjectDesignerDefaultViewSchema,
  ObjectDesignerConfigSchema,

  // Object Designer Types
  type FieldPropertySection,
  type FieldGroup,
  type FieldEditorConfig,
  type RelationshipDisplay,
  type RelationshipMapperConfig,
  type ERLayoutAlgorithm,
  type ERNodeDisplay,
  type ERDiagramConfig,
  type ObjectListDisplayMode,
  type ObjectSortField,
  type ObjectFilter,
  type ObjectManagerConfig,
  type ObjectPreviewTab,
  type ObjectPreviewConfig,
  type ObjectDesignerDefaultView,
  type ObjectDesignerConfig,

  // Object Designer Helpers
  defineObjectDesignerConfig,
} from './object-designer.zod';

// Page Builder schemas removed — they configured the `blank` page-type drag-drop
// canvas, which has no renderer and was dropped from PageTypeSchema (framework#2265).

export {
  // Flow Builder Schemas
  FlowNodeShapeSchema,
  FlowNodeRenderDescriptorSchema,
  FlowCanvasNodeSchema,
  FlowCanvasEdgeStyleSchema,
  FlowCanvasEdgeSchema,
  FlowLayoutAlgorithmSchema,
  FlowLayoutDirectionSchema,
  FlowBuilderConfigSchema,
  BUILT_IN_NODE_DESCRIPTORS,

  // Flow Builder Types
  type FlowNodeShape,
  type FlowNodeRenderDescriptor,
  type FlowCanvasNode,
  type FlowCanvasEdgeStyle,
  type FlowCanvasEdge,
  type FlowLayoutAlgorithm,
  type FlowLayoutDirection,
  type FlowBuilderConfig,

  // Flow Builder Helpers
  defineFlowBuilderConfig,
} from './flow-builder.zod';
