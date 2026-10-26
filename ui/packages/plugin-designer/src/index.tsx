/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { PageDesigner } from './PageDesigner';
import { DataModelDesigner } from './DataModelDesigner';
import { ProcessDesigner } from './ProcessDesigner';
import { ReportDesigner } from './ReportDesigner';
import { CollaborationProvider, ConnectionStatusIndicator } from './CollaborationProvider';
import { AppCreationWizard } from './AppCreationWizard';
import { NavigationDesigner } from './NavigationDesigner';
import { EditorModeToggle } from './EditorModeToggle';
import { DashboardEditor } from './DashboardEditor';
import { BrandingEditor } from './BrandingEditor';
import { ObjectManager } from './ObjectManager';
import { FieldDesigner } from './FieldDesigner';

export {
  PageDesigner,
  DataModelDesigner,
  ProcessDesigner,
  ReportDesigner,
  CollaborationProvider,
  ConnectionStatusIndicator,
  AppCreationWizard,
  NavigationDesigner,
  EditorModeToggle,
  DashboardEditor,
  BrandingEditor,
  ObjectManager,
  FieldDesigner,
};

export type { AppCreationWizardProps } from './AppCreationWizard';
export type { NavigationDesignerProps } from './NavigationDesigner';
export type { EditorModeToggleProps } from './EditorModeToggle';
export type { DashboardEditorProps } from './DashboardEditor';
export type { BrandingEditorProps } from './BrandingEditor';
export type { ObjectManagerProps } from './ObjectManager';
export type { FieldDesignerProps } from './FieldDesigner';

// Shared hooks
export { useUndoRedo } from './hooks/useUndoRedo';
export { useDesignerHistory } from './hooks/useDesignerHistory';
export { useConfirmDialog } from './hooks/useConfirmDialog';
export { useClipboard } from './hooks/useClipboard';
export { useMultiSelect } from './hooks/useMultiSelect';
export { useCanvasPanZoom } from './hooks/useCanvasPanZoom';
// The provider-less fallback table, exported so objectui#4401's mirror gate can
// compare it against the `en` pack from a package that depends on both.
export { DESIGNER_DEFAULT_TRANSLATIONS } from './hooks/useDesignerTranslation';

// Shared components
export { ConfirmDialog } from './components/ConfirmDialog';
export { Minimap } from './components/Minimap';
export { PropertyEditor } from './components/PropertyEditor';
export { VersionHistory } from './components/VersionHistory';

// Route-ready app authoring pages — host apps mount these at their
// preferred routes. Each page expects an active app/adapter context from
// @object-ui/app-shell and uses react-router-dom hooks
// (useParams/useNavigate) for navigation.
export { CreateAppPage } from './pages/CreateAppPage';
export { EditAppPage } from './pages/EditAppPage';
export { DashboardDesignPage } from './pages/DashboardDesignPage';

// Metadata management pages (Setup-app "Data Model" group). These talk
// directly to the metadata REST API (`/api/v1/meta/*`) via
// `MetadataClient` from `@object-ui/data-objectstack`, and do not require
// an app/adapter context. They are the visual counterpart of the
// `sys_metadata` object's `only_objects` / `only_fields` list views.
export { MetadataObjectsPage } from './MetadataObjectsPage';
export type { MetadataObjectsPageProps } from './MetadataObjectsPage';
export { MetadataFieldsPage } from './MetadataFieldsPage';
export type { MetadataFieldsPageProps } from './MetadataFieldsPage';

/*
 * The designer registrations' `inputs` (objectui#11434's sweep). `inputs` is
 * an authoring surface: the html-tier page compiler builds its manifest from
 * every known registration and its `validateTree` answers `unknown-prop` for a
 * node key no input names — so a member the component READS but no row lists
 * is warned off although it works. Measured against the six node declarations
 * in `@object-ui/types`, the rows below are exactly the read members. What no
 * row lists is unlisted on purpose: `body` and `children` (no designer reads a
 * content channel, and both faces refuse them), and the retired tombstones
 * (`autoLayout`, `previewMode`). Every row declares the kind its value has
 * (`array` / `object` / `enum` / `string` / `boolean`): a `code` row answered
 * `type-mismatch` ("expected a string") on every legal array or object value,
 * the shape objectui#10993 settled on the registration row by declaring the
 * `object` arm. Nothing else reads these rows' kinds: the published
 * `sdui.manifest.json` and the `kind:'react'` scope carry the public tier
 * alone, which no designer is in.
 */
ComponentRegistry.register('page-designer', PageDesigner, {
  namespace: 'plugin-designer',
  label: 'Page Designer',
  category: 'Designer',
  inputs: [
    { name: 'canvas', type: 'object' },
    { name: 'components', type: 'array' },
    { name: 'palette', type: 'array' },
    { name: 'propertyEditor', type: 'boolean' },
    { name: 'showComponentTree', type: 'boolean' },
    { name: 'undoRedo', type: 'boolean' },
    { name: 'readOnly', type: 'boolean' },
  ],
});

ComponentRegistry.register('data-model-designer', DataModelDesigner, {
  namespace: 'plugin-designer',
  label: 'Data Model Designer',
  category: 'Designer',
  inputs: [
    { name: 'entities', type: 'array' },
    { name: 'relationships', type: 'array' },
    { name: 'canvas', type: 'object' },
    { name: 'showRelationshipLabels', type: 'boolean' },
    { name: 'readOnly', type: 'boolean' },
  ],
});

ComponentRegistry.register('process-designer', ProcessDesigner, {
  namespace: 'plugin-designer',
  label: 'Process Designer (BPMN)',
  category: 'Designer',
  inputs: [
    { name: 'processName', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'nodes', type: 'array' },
    { name: 'edges', type: 'array' },
    { name: 'lanes', type: 'array' },
    { name: 'canvas', type: 'object' },
    { name: 'showMinimap', type: 'boolean' },
    { name: 'showToolbar', type: 'boolean' },
    { name: 'readOnly', type: 'boolean' },
  ],
});

ComponentRegistry.register('report-designer', ReportDesigner, {
  namespace: 'plugin-designer',
  label: 'Report Designer',
  category: 'Designer',
  inputs: [
    { name: 'reportName', type: 'string' },
    { name: 'objectName', type: 'string' },
    { name: 'pageSize', type: 'enum', enum: ['A4', 'A3', 'Letter', 'Legal', 'Tabloid'] },
    { name: 'orientation', type: 'enum', enum: ['portrait', 'landscape'] },
    { name: 'margins', type: 'object' },
    { name: 'sections', type: 'array' },
    { name: 'showToolbar', type: 'boolean' },
    { name: 'showPropertyPanel', type: 'boolean' },
    { name: 'readOnly', type: 'boolean' },
  ],
});

/**
 * ⛔ Four node type keys are RETIRED here (objectui#10859 batch 8, phase 2b,
 * the seat's ruling on that card, by the objectui#10393 / objectui#8760
 * route): `app-creation-wizard`, `navigation-designer`, `dashboard-editor` and
 * `branding-editor`. `AppCreationWizard`, `NavigationDesigner`,
 * `DashboardEditor` and `BrandingEditor` stay named exports of this package.
 *
 * ## What was here, and why it went
 *
 * One `ComponentRegistry.register(KEY, Component, { namespace:
 * 'plugin-designer', category: 'Designer', ... })` per key — builder chrome
 * published as node keys, each storing `plugin-designer:KEY` and the bare
 * `KEY` fallback. No `@object-ui/types` arm claims any of them, so
 * `objectui validate` refused a node authored with one of these types at
 * `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the nodes: 0 occurrences of any of the four as a node type in
 * source, docs, examples, the catalog or objectstack, and 0 runtime emission,
 * re-measured for phase 2b. The React components are mounted directly
 * wherever they are used, so no host loses a path. The designer registrations
 * around this block (`page-designer`, `object-manager` and the rest) are not
 * part of this retirement.
 */

ComponentRegistry.register('object-manager', ObjectManager, {
  namespace: 'plugin-designer',
  label: 'Object Manager',
  category: 'Designer',
  inputs: [
    { name: 'objects', type: 'array' },
    { name: 'showSystemObjects', type: 'boolean' },
    { name: 'readOnly', type: 'boolean' },
  ],
});

ComponentRegistry.register('field-designer', FieldDesigner, {
  namespace: 'plugin-designer',
  label: 'Field Designer',
  category: 'Designer',
  inputs: [
    { name: 'objectName', type: 'string' },
    { name: 'fields', type: 'array' },
    { name: 'readOnly', type: 'boolean' },
  ],
});
