// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

import * as objects from './src/objects/index.js';
import * as views from './src/views/index.js';
import * as apps from './src/apps/index.js';
import * as dashboards from './src/dashboards/index.js';
import * as datasets from './src/datasets/index.js';
import * as translations from './src/translations/index.js';
import { StarterSeedData } from './src/data/index.js';

/**
 * Starter app — companies and the people at them, with the platform's tasks
 * and notes in the same menu.
 *
 * A small, complete app an organization installs and then makes its own: two
 * objects (`starter_company`, `starter_contact`), a grid and a board for each,
 * the company's contacts on its record page, sample rows, and one dashboard.
 * Tasks and notes are not part of the package: the menu points at the
 * platform's `sys_task` and `sys_note`, so they stay when the package goes.
 */
export default defineStack({
  manifest: {
    id: 'com.example.starter',
    namespace: 'starter',
    version: '0.1.0',
    type: 'app',
    name: 'Starter',
    description: 'Companies and contacts, with the platform\'s tasks and notes in the menu.',
    // Protocol major this package is authored against (ADR-0087).
    engines: { protocol: '^19' },
    // A starter is taken over by the organization that installs it: an
    // unmanaged install copies every item into the environment, where it is
    // edited like anything authored in Studio. `managed` stays permitted for
    // a deployment that walls organizations, where an unmanaged copy is
    // refused, and for an install that names no mode.
    installModes: ['managed', 'unmanaged'],
  },

  objects: Object.values(objects),
  views: Object.values(views),
  apps: Object.values(apps),
  dashboards: Object.values(dashboards),
  datasets: Object.values(datasets),

  data: StarterSeedData,

  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN'],
    fallbackLocale: 'en',
  },
  translations: Object.values(translations),
});
