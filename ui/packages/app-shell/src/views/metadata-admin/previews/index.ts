// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in Preview-tab registrations.
 *
 * Each registration is one line; new types are trivially added without
 * touching `ResourceEditPage.tsx`. To opt OUT of a built-in preview in
 * a downstream app, call `registerMetadataPreview(type, MyVersion)`
 * after this module runs — `registerMetadataPreview` is last-write-wins.
 */

import { registerMetadataPreview } from '../preview-registry.js';
import { PagePreview } from './PagePreview.js';
import { ViewPreview } from './ViewPreview.js';
import { DashboardPreview } from './DashboardPreview.js';
import { ReportPreview } from './ReportPreview.js';
import { AppPreview } from './AppPreview.js';
import { ObjectPreview } from './ObjectPreview.js';
import { EmailTemplatePreview } from './EmailTemplatePreview.js';
import { FlowPreview } from './FlowPreview.js';
import { AgentPreview } from './AgentPreview.js';
import { ToolPreview } from './ToolPreview.js';
import { PermissionPreview } from './PermissionPreview.js';
import { ActionPreview } from './ActionPreview.js';
import { JobPreview } from './JobPreview.js';
import { TranslationPreview } from './TranslationPreview.js';
import { PositionPreview } from './PositionPreview.js';
import { SkillPreview } from './SkillPreview.js';
import { DatasourcePreview } from './DatasourcePreview.js';
import { ValidationPreview } from './ValidationPreview.js';
import { DatasetPreview } from './DatasetPreview.js';
import { BookPreview } from './BookPreview.js';
import { DocPreview } from './DocPreview.js';
import { PicklistPreview } from './PicklistPreview.js';

export function registerBuiltinPreviews(): void {
  // UI surfaces
  registerMetadataPreview('page', PagePreview);
  registerMetadataPreview('view', ViewPreview);
  registerMetadataPreview('dashboard', DashboardPreview);
  registerMetadataPreview('report', ReportPreview);
  registerMetadataPreview('app', AppPreview);
  registerMetadataPreview('action', ActionPreview);
  // Data
  registerMetadataPreview('object', ObjectPreview);
  registerMetadataPreview('datasource', DatasourcePreview);
  // objectui#10202 — the shared picklist's read-only page: its options, and the
  // options other packages add to it, each under its declaring package. The
  // kind is package-owned, so the page offers no create, edit or delete.
  registerMetadataPreview('picklist', PicklistPreview);
  // ADR-0088 retired STANDALONE `validation` items, and objectui#4132 removed
  // the console door that authored them. This registration is not residue: a
  // rule lives embedded in `object.validations`, and `EmbeddedItemEditor` looks
  // the renderer up by the anchor's `editAs` — so the preview now runs on the
  // path the framework evaluates instead of the one it retired.
  registerMetadataPreview('validation', ValidationPreview);
  // Analytics (ADR-0021): live cross-object dataset preview.
  registerMetadataPreview('dataset', DatasetPreview);
  // System
  registerMetadataPreview('email_template', EmailTemplatePreview);
  registerMetadataPreview('translation', TranslationPreview);
  // Documentation navigation spine (ADR-0046 §6): ordered groups with
  // derived membership over docs.
  registerMetadataPreview('book', BookPreview);
  // The doc itself (ADR-0046): a Markdown source pane beside a live preview,
  // its locale variants and its book-section placement (objectui#10188).
  registerMetadataPreview('doc', DocPreview);
  // Automation
  // Approval is a flow node (`type: 'approval'`) since ADR-0019 — it renders on
  // the Flow canvas with its `approve` / `reject` branches; no standalone
  // approval-process preview.
  registerMetadataPreview('flow', FlowPreview);
  // ADR-0020: `workflow` retired as a metadata type — record state machines
  // are now a `state_machine` validation rule (rendered by ValidationPreview)
  // and side-effecting automation is a Flow. No standalone workflow preview.
  registerMetadataPreview('job', JobPreview);
  // AI
  registerMetadataPreview('agent', AgentPreview);
  registerMetadataPreview('tool', ToolPreview);
  registerMetadataPreview('skill', SkillPreview);
  // Security & Identity
  // ADR-0090 D2 removed the Profile concept and D3 renamed role → position;
  // the `profile`/`role` registrations stay only so metadata from pre-v2
  // backends still renders (inert otherwise).
  registerMetadataPreview('permission', PermissionPreview);
  registerMetadataPreview('profile', PermissionPreview);
  registerMetadataPreview('position', PositionPreview);
  registerMetadataPreview('role', PositionPreview);
}
