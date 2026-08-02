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
  ActionLocationSchema,
  MetadataIconContributionSchema,
  PanelContributionSchema,
  PanelLocationSchema,
  CommandContributionSchema,
  StudioPluginContributionsSchema,
  // [#4653] `ActivationEventSchema` / `ActivationEvent` are RE-EXPORTS of the
  // single declaration in `kernel/plugin-runtime.zod.ts`, not a second source.
  // Studio plugin authors keep importing them from `@objectstack/spec/studio`.
  ActivationEventSchema,
  StudioPluginManifestSchema,

  // Types
  type ViewMode,
  type MetadataViewerContribution,
  type SidebarGroupContribution,
  type ActionContribution,
  type MetadataIconContribution,
  type PanelContribution,
  type CommandContribution,
  type StudioPluginContributions,
  type StudioPluginManifest,
  type ActivationEvent,

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
