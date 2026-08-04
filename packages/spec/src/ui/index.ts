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
export * from './touch.zod';
export * from './offline.zod';
export * from './keyboard.zod';
export * from './animation.zod';
// `notification.zod` still exports the three presentation enums
// (`NotificationType` / `NotificationSeverity` / `NotificationPosition`);
// `NotificationActionSchema` / `NotificationAction` were REMOVED at #5015 per
// ADR-0049 enforce-or-remove — no carrier key, unreachable from every metadata
// root, zero parse. See the block in that module.
export * from './notification.zod';
export * from './dnd.zod';
// `sharing.zod` still exports the LIVE `SharingConfigSchema` (carried by
// `FormViewSchema.sharing`; `rest-server.ts` gates the anonymous form routes on
// it). `EmbedConfigSchema` / `EmbedConfig` were REMOVED at #5015 per ADR-0049 —
// one file, two verdicts. See the block in that module.
export * from './sharing.zod';
