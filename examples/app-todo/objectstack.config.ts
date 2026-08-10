// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

// ─── Barrel Imports (one per metadata type) ─────────────────────────
import * as objects from './src/objects/index.js';
// [#7036] Lifecycle hooks are NOT collected from the objects barrel — the
// runtime reads them from `defineStack({ hooks })` only (`collectBundleHooks`).
// An unregistered `*.hook.ts` file is dead metadata: it type-checks, it reads
// as wired, and it never runs.
import taskHook from './src/objects/task.hook.js';
import * as actions from './src/actions/index.js';
import * as dashboards from './src/dashboards/index.js';
import * as datasets from './src/datasets/index.js';
import * as reports from './src/reports/index.js';
import * as views from './src/views/index.js';
import { allFlows } from './src/flows/index.js';
import * as apps from './src/apps/index.js';
import { TodoSeedData } from './src/data/index.js';
import * as translations from './src/translations/index.js';

// ─── Action Handler Registration (runtime lifecycle) ────────────────
// Handlers are wired separately from metadata. The `onEnable` export
// is called by the kernel's AppPlugin after the engine is ready.
// See: src/actions/register-handlers.ts for the full registration flow.
import { registerTaskActionHandlers } from './src/actions/register-handlers.js';

/**
 * Plugin lifecycle hook — called by AppPlugin when the engine is ready.
 * This is where action handlers are registered on the ObjectQL engine.
 */
export const onEnable = async (ctx: { ql: { registerAction: (...args: unknown[]) => void } }) => {
  registerTaskActionHandlers(ctx.ql);
};

export default defineStack({
  manifest: {
    id: 'com.example.todo',
    namespace: 'todo',
    version: '2.0.0',
    type: 'app',
    name: 'Todo Manager',
    description: 'A comprehensive Todo app demonstrating ObjectStack Protocol features including automation, dashboards, and reports',
    // Protocol major this package is authored against (ADR-0087). The kernel
    // checks the range at load time and refuses a major-incompatible runtime
    // with a structured diagnostic instead of failing deep in a schema parse.
    engines: { protocol: '^17' },
  },

  // Seed Data (top-level, registered as metadata)
  data: TodoSeedData,

  // Object Lifecycle Hooks (same shape as app-crm / app-showcase)
  hooks: [taskHook],

  // Auto-collected from barrel index files via Object.values()
  objects: Object.values(objects),
  views: Object.values(views),
  actions: Object.values(actions),
  dashboards: Object.values(dashboards),
  datasets: Object.values(datasets),
  reports: Object.values(reports),
  flows: allFlows,
  apps: Object.values(apps),

  // I18n Configuration — per-locale file organization
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN', 'ja-JP'],
    fallbackLocale: 'en',
  },

  // I18n Translation Bundles (en, zh-CN, ja-JP)
  translations: Object.values(translations),
});

