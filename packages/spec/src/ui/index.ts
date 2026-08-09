// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UI Protocol Exports
 * 
 * Presentation & Interaction
 * - App, Page, View (Grid/Kanban)
 * - Dashboard (Widgets), Report
 * - Action (Triggers)
 * - Chart (Unified Visualization Types)
 */

export * from './chart.zod';
export * from './chart-aggregate';
export * from './i18n.zod';
// `resolveI18nLabel` — the shared `I18nLabel` → `string` resolver (#6765,
// #6761 ruling B). The rule that reads an inline locale map lives here, ONCE,
// so a backend producer never has to grow a private copy of it.
export * from './i18n-label-resolver';
export * from './responsive.zod';
export * from './app.zod';
export * from './bulk-action.zod';
export * from './view.zod';
export * from './dashboard.zod';
export * from './report.zod';
export * from './dataset.zod';
export { reportForm } from './report.form';
export { viewForm } from './view.form';
export { appForm } from './app.form';
export { dashboardForm } from './dashboard.form';
export { datasetForm } from './dataset.form';
export { actionForm } from './action.form';
export { pageForm } from './page.form';
export * from './action.zod';
// Action-param value validation (ADR-0104 D2)
export * from './action-params.zod';
export * from './page.zod';
export * from './widget.zod';
export * from './component.zod';
export * from './react-blocks';
export * from './theme.zod';
// `notification.zod` still exports the three presentation enums
// (`NotificationType` / `NotificationSeverity` / `NotificationPosition`);
// `NotificationActionSchema` / `NotificationAction` were REMOVED at #5015 per
// ADR-0049 enforce-or-remove — no carrier key, unreachable from every metadata
// root, zero parse. See the block in that module.
export * from './notification.zod';
// `sharing.zod` still exports the LIVE `SharingConfigSchema` (carried by
// `FormViewSchema.sharing`; `rest-server.ts` gates the anonymous form routes on
// it). `EmbedConfigSchema` / `EmbedConfig` were REMOVED at #5015 per ADR-0049 —
// one file, two verdicts. See the block in that module.
export * from './sharing.zod';

// ---------------------------------------------------------------------------
// RETIRED in v17 (#4988, ADR-0049 enforce-or-remove): the five interaction
// config modules that used to be re-exported from here —
// `touch.zod` / `dnd.zod` / `keyboard.zod` / `animation.zod` / `offline.zod`
// (22 `z.object` sites, 32 emitted defs, 64 exported names) — were deleted with
// their reference docs.
//
// They had NO carrier key anywhere in the protocol: nothing under
// `packages/spec/src` imported them except this barrel, so no metadata document
// could reach them and no `.parse()` existed for them in objectstack, objectui
// or the example apps. What they described is RENDERER BUILT-IN BEHAVIOR
// (touch targets, drag-and-drop, focus/shortcuts, motion), not per-page author
// metadata; offline is a platform capability whose vocabulary belongs on a sync
// engine that does not exist yet. Whichever of them earns real product pull
// returns WITH its own vocabulary and its executor, the #4910 way — not by
// un-retiring a declaration.
//
// ⚠️ Do NOT re-add an `export *` here "to unblock a consumer". An exported
// schema with no consumer is read as a capability (#3950), and a precisely
// validated dead slot is the more convincing lie (#4583). Absence and survival
// are both pinned in `interaction-config-retirement.test.ts`.
// ---------------------------------------------------------------------------
