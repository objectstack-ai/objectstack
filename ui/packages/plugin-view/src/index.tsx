/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useContext } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ObjectView } from './ObjectView';
import { ViewSwitcher } from './ViewSwitcher';
import { FilterUI } from './FilterUI';
import { SortUI } from './SortUI';
import { SharedViewLink } from './SharedViewLink';

export { ObjectView, ViewSwitcher, FilterUI, SortUI, SharedViewLink };
export { ViewTabBar } from './ViewTabBar';
export { ManageViewsDialog } from './ManageViewsDialog';
export { deriveRecordSurface, deriveRecordFlowSurface, RECORD_SURFACE_PAGE_THRESHOLD, deriveOverlaySize, overlayWidthFor } from './recordSurface';
export type { RecordSurface, OverlaySize, RecordFlow, RecordFlowContainer, RecordFlowSurface } from './recordSurface';
export type { ObjectViewProps } from './ObjectView';
export type { ViewSwitcherProps } from './ViewSwitcher';
export type { ViewTabBarProps, ViewTabItem, AvailableViewType } from './ViewTabBar';
export type { ManageViewsDialogProps } from './ManageViewsDialog';
export type { FilterUIProps } from './FilterUI';
export type { SortUIProps } from './SortUI';
export type { SharedViewLinkProps } from './SharedViewLink';

// View config helpers (field options, filter/sort builders, view-type
// metadata). The runtime ViewConfigPanel now hosts the studio's spec-driven
// inspector, so the legacy `buildViewConfigSchema` engine has been retired;
// these utilities still back the CreateViewDialog field pickers.
export {
  deriveFieldOptions,
  toFilterGroup,
  toSortItems,
  VIEW_TYPE_LABELS,
  VIEW_TYPE_OPTIONS,
  isImageLikeField,
  isGeoLikeField,
  pickPreferredField,
  KANBAN_GROUP_PREFERRED,
  PRIMARY_DATE_PREFERRED,
  END_DATE_PREFERRED,
  TITLE_PREFERRED,
} from './config/view-config-utils';
export type { FieldOption } from './config/view-config-utils';

// Register object-view component
const ObjectViewRenderer: React.FC<{ schema: any }> = ({ schema }) => {
  // Resolve dataSource from SchemaRendererProvider context, read AS DECLARED
  // (objectui#7209). This module used to re-declare the imported context as a
  // `Context` of `any`, which let every read of it — including a member the
  // context does not declare — compile clean. Pinned by
  // `objectViewRenderer.schemaRendererContextRead-7209.test.ts`.
  const ctx = useContext(SchemaRendererContext);
  // What that erasure also hid here, now spelled out at this one value instead
  // of across the whole context: with no adapter bound this renderer hands
  // `null` to `ObjectViewProps.dataSource`, which is declared REQUIRED and stays
  // so (objectui#7842 — widening it is a maintainer's ruling). `ObjectView`
  // guards every use of a missing adapter and renders its chrome empty; its prop
  // documentation names this renderer as that `null` caller.
  const dataSource = (ctx?.dataSource ?? null) as DataSource;

  return <ObjectView schema={schema} dataSource={dataSource} />;
};

ComponentRegistry.register('object-view', ObjectViewRenderer, {
  namespace: 'plugin-view',
  label: 'Object View',
  category: 'view',
  icon: 'LayoutDashboard',
  inputs: [
    { name: 'objectName', type: 'string', required: true },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'layout', type: 'enum', enum: ['drawer', 'modal', 'page'] },
    { name: 'defaultViewType', type: 'enum', enum: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map'] },
    { name: 'defaultListView', type: 'string' },
    { name: 'showSearch', type: 'boolean' },
    { name: 'showFilters', type: 'boolean' },
    { name: 'showCreate', type: 'boolean' },
    { name: 'showViewSwitcher', type: 'boolean' },
    { name: 'listViews', type: 'object' },
    { name: 'navigation', type: 'object' },
    { name: 'searchableFields', type: 'array' },
  ],
  defaultProps: {
    layout: 'drawer',
    defaultViewType: 'grid',
    showSearch: true,
    showFilters: true,
    showCreate: true,
    showViewSwitcher: true,
  },
});

/**
 * ⛔ The bare `view` node type key is RETIRED (objectui#10859 batch 8, the
 * seat's ruling on that card, by the objectui#10393 / objectui#8760 route).
 * `object-view` is the one spelling this plugin serves for this renderer.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('view', ObjectViewRenderer, { namespace:
 * 'plugin-view', ... })` — an alias on the SAME renderer, which stored both
 * `plugin-view:view` and the bare `view` fallback. It declared no `inputs`, and
 * no arm of `AnyComponentSchema` claims `view`, so `objectui validate` refused
 * a node authored `type: 'view'` at `type` while the registry mounted it —
 * while `object-view`, the same renderer, validates.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples or the
 * catalog, measured for the card. The `type: 'view'` spellings elsewhere in the
 * stack are the METADATA namespace (saved views, `client.meta.getItems('view')`),
 * a different layer that stays untouched. The package README's and
 * `content/docs/plugins/plugin-view.mdx`'s registration tables lost the row in
 * the same change.
 */

ComponentRegistry.register('view-switcher', ViewSwitcher, {
  namespace: 'view',
  label: 'View Switcher',
  category: 'view',
  icon: 'LayoutGrid',
  inputs: [
    { name: 'views', type: 'array', required: true },
    { name: 'defaultView', type: 'string' },
    { name: 'activeView', type: 'string' },
    { name: 'variant', type: 'enum', enum: ['tabs', 'buttons', 'dropdown'] },
    { name: 'position', type: 'enum', enum: ['top', 'bottom', 'left', 'right'] },
    { name: 'persistPreference', type: 'boolean' },
    { name: 'storageKey', type: 'string' },
    { name: 'onViewChange', type: 'string' },
  ],
  defaultProps: {
    variant: 'tabs',
    position: 'top',
    defaultView: 'grid',
    views: [
      { type: 'grid', label: 'Grid', schema: { type: 'text', content: 'Grid view' } },
      { type: 'list', label: 'List', schema: { type: 'text', content: 'List view' } },
    ],
  },
});

ComponentRegistry.register('filter-ui', FilterUI, {
  namespace: 'view',
  label: 'Filter UI',
  category: 'view',
  icon: 'SlidersHorizontal',
  inputs: [
    { name: 'filters', type: 'array', required: true },
    { name: 'values', type: 'object' },
    { name: 'onChange', type: 'string' },
    { name: 'showClear', type: 'boolean' },
    { name: 'showApply', type: 'boolean' },
    { name: 'layout', type: 'enum', enum: ['inline', 'popover', 'drawer'] },
  ],
  defaultProps: {
    layout: 'inline',
    showApply: false,
    showClear: true,
    filters: [
      { field: 'name', label: 'Name', type: 'text', placeholder: 'Search name' },
      { field: 'status', label: 'Status', type: 'select', options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed', value: 'closed' },
      ] },
      { field: 'created_at', label: 'Created', type: 'date' },
    ],
  },
});

ComponentRegistry.register('sort-ui', SortUI, {
  namespace: 'view',
  label: 'Sort UI',
  category: 'view',
  icon: 'ArrowUpDown',
  inputs: [
    { name: 'fields', type: 'array', required: true },
    { name: 'sort', type: 'array' },
    { name: 'onChange', type: 'string' },
    { name: 'multiple', type: 'boolean' },
    { name: 'variant', type: 'enum', enum: ['dropdown', 'buttons'] },
  ],
  defaultProps: {
    variant: 'dropdown',
    multiple: true,
    fields: [
      { field: 'name', label: 'Name' },
      { field: 'created_at', label: 'Created At' },
    ],
    sort: [{ field: 'name', direction: 'asc' }],
  },
});

/**
 * ⛔ The `shared-view-link` node type key is RETIRED (objectui#10859 batch 8, phase 2b,
 * the seat's ruling on that card, by the objectui#10393 / objectui#8760 route).
 * `SharedViewLink` stays a named export of this package.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('shared-view-link', SharedViewLink, {
 * namespace: 'view', ... })` — the share-link control published as a node key.
 * It stored both `view:shared-view-link` and the bare `shared-view-link` fallback.
 * No `@object-ui/types` arm claims it, so `objectui validate` refused a node
 * authored `type: 'shared-view-link'` at `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples, the catalog
 * or objectstack, and 0 runtime emission, re-measured for phase 2b. The ruling's
 * criterion answered no for a NODE: the mainstream keeps sharing as a
 * view-level action, not an authorable block. The README and `plugin-view.mdx`
 * key-table rows went in the same change.
 */

// Simple View Renderer (Container)
const SimpleViewRenderer: React.FC<any> = ({ schema, className, children, dataSource, ...props }) => {
  // If columns prop is present, use grid layout
  const style = schema.props?.columns 
    ? { display: 'grid', gridTemplateColumns: `repeat(${schema.props.columns}, 1fr)`, gap: '1rem' }
    : undefined;

  return (
    <div 
      className={className} 
      style={style}
      {...props}
    >
      {children}
    </div>
  );
};

ComponentRegistry.register('view:simple', SimpleViewRenderer, {
  namespace: 'plugin-view',
  label: 'Simple View',
  category: 'view'
});
