// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Registers built-in metadata inspectors. Mirrors `previews/index.ts`.
 * Imported as a side effect from `metadata-admin/index.ts`.
 */

import { registerMetadataInspector } from '../inspector-registry.js';
import { registerMetadataDefaultInspector } from '../default-inspector-registry.js';
import { DashboardWidgetInspector } from './DashboardWidgetInspector.js';
import { DashboardDefaultInspector } from './DashboardDefaultInspector.js';
import { FlowInspector } from './FlowInspector.js';
import { AppNavInspector } from './AppNavInspector.js';
import { ViewInspector, ViewDefaultInspector } from './ViewInspector.js';
import { PageBlockInspector } from './PageBlockInspector.js';
import { PageDefaultInspector } from './PageDefaultInspector.js';
import { ReportDefaultInspector } from './ReportDefaultInspector.js';
import { ObjectFieldInspector } from './ObjectFieldInspector.js';
import { ObjectDefaultInspector } from './ObjectDefaultInspector.js';
import { DatasetDefaultInspector } from './DatasetDefaultInspector.js';
import { ActionDefaultInspector } from './ActionDefaultInspector.js';
import { HookDefaultInspector } from './HookDefaultInspector.js';

export function registerBuiltinInspectors(): void {
  registerMetadataInspector('dashboard', DashboardWidgetInspector);
  registerMetadataDefaultInspector('dashboard', DashboardDefaultInspector);
  // Approval is authored as a flow node (`type: 'approval'`) since ADR-0019 —
  // edited through FlowInspector, not a standalone step inspector. FlowInspector
  // routes node vs. edge selections to the right scoped editor.
  registerMetadataInspector('flow', FlowInspector);
  // ADR-0020: `workflow` retired as a metadata type — no workflow-action
  // inspector. State machines live on the object as a `state_machine`
  // validation rule.
  registerMetadataInspector('app', AppNavInspector);
  registerMetadataInspector('view', ViewInspector);
  registerMetadataDefaultInspector('view', ViewDefaultInspector);
  registerMetadataInspector('page', PageBlockInspector);
  // Interface/list pages (kanban/calendar/gallery/gantt — `type:'list'` +
  // `interfaceConfig.source`) have no block tree, so the block inspector never
  // fires. The default inspector renders the spec-driven page/interfaceConfig
  // form so those pages are editable from the panel, not just the empty state.
  registerMetadataDefaultInspector('page', PageDefaultInspector);
  // ADR-0021 single-form: a 9.0 report selects dataset measures/dimensions
  // by NAME (no per-column config document), so there is no scoped column
  // inspector — the default inspector owns the whole editing surface.
  registerMetadataDefaultInspector('report', ReportDefaultInspector);
  registerMetadataInspector('object', ObjectFieldInspector);
  registerMetadataDefaultInspector('object', ObjectDefaultInspector);
  // ADR-0021: structured dataset designer (object/include/dimensions/measures).
  registerMetadataDefaultInspector('dataset', DatasetDefaultInspector);
  // Type-aware Action authoring (Salesforce/ServiceNow-style): branch the form
  // by action type, group inputs/placement/feedback/conditions/AI, fall back to
  // SchemaForm for advanced props.
  registerMetadataDefaultInspector('action', ActionDefaultInspector);
  // Curated Hook authoring: object PICKER (not free text) + lifecycle events +
  // a dedicated handler-body code editor, falling back to SchemaForm for
  // advanced props. Replaces the flat generic form for `hook`.
  registerMetadataDefaultInspector('hook', HookDefaultInspector);
}
