// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

import * as objects from './src/objects/index.js';
import * as views from './src/views/index.js';
import * as apps from './src/apps/index.js';
import * as dashboards from './src/dashboards/index.js';
import * as datasets from './src/datasets/index.js';
import * as pages from './src/pages/index.js';
import * as actions from './src/actions/index.js';
import { allHooks } from './src/hooks/index.js';
import { allFlows } from './src/flows/index.js';
import {
  SalesRepPosition,
  SalesManagerPosition,
  FinanceApproverPosition,
  SalesUserPermissionSet,
  GuestPortalProfile,
  HighValueOpportunitySharingRule,
  RepLeadSharingRule,
  WonDealActivitySharingRule,
} from './src/security/index.js';
import { registerCrmPositionBindings } from './src/security/bind-position-sets.js';
import { CrmSeedData } from './src/data/index.js';
import { CrmDatasource, CrmAnalyticsDatasource } from './src/datasources/crm.datasource.js';
import { CrmTranslationBundle } from './src/translations/crm.translation.js';

/**
 * CRM example — a MINIMAL, realistic relational bundle that smoke-tests the
 * metadata application loading pipeline: objects/relationships → views →
 * app → dashboard (dataset-backed) → hook → one screen-flow wizard → seed.
 * Deliberately small so `pnpm dev:crm` boots fast for backend debugging.
 *
 * NOT a feature showcase: capability breadth (cubes, extensions, apis,
 * webhooks, portals, themes, reports, jobs, emails, automation variety)
 * lives in examples/app-showcase, whose coverage manifest enforces it.
 * For a full enterprise reference see https://github.com/objectstack-ai/hotcrm
 */
export default defineStack({
  manifest: {
    id: 'com.example.crm',
    namespace: 'crm',
    version: '4.0.0',
    type: 'app',
    name: 'CRM (minimal example)',
    description: 'Minimal CRM workspace used by the framework to validate the metadata loading pipeline end-to-end.',
    // Protocol major this package is authored against (ADR-0087). The kernel
    // checks the range at load time and refuses a major-incompatible runtime
    // with a structured diagnostic instead of failing deep in a schema parse.
    engines: { protocol: '^17' },
  },

  // Auto-resolved by the CLI; `ui` enables the Studio shell, `automation`
  // loads AutomationServicePlugin + node packs so the convert-lead screen
  // flow can execute.
  requires: ['ui', 'automation'],

  // Infrastructure
  //
  // No `datasourceMapping`. These two datasources are declared to exercise the
  // metadata surface, not to route anything: both are `:memory:`, and every
  // object here has always been served by the host's `default` store. The
  // mapping that used to sit here (`namespace: 'crm'` + `default: true` →
  // `crm_primary`) was decorative — `namespace` is deprecated and no object
  // sets it, and `crm_primary` had no live driver, so routing fell through to
  // `default`. #4462 stopped routing from falling through, because that
  // fall-through is what silently put a mapped object's rows in a different
  // database than the one it declared. Deleting the rule is what keeps this
  // example's behavior IDENTICAL under the new posture; keeping it would move
  // the whole app — platform objects included — onto an in-memory database
  // that is empty on every boot.
  datasources: [CrmDatasource, CrmAnalyticsDatasource],

  // Internationalisation
  translations: [CrmTranslationBundle],
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN'],
    fallbackLocale: 'en',
  },

  // Data
  objects: Object.values(objects),

  // UI
  apps: Object.values(apps),
  views: Object.values(views),
  pages: Object.values(pages),
  dashboards: Object.values(dashboards),
  datasets: Object.values(datasets),
  actions: Object.values(actions),

  // Logic
  hooks: allHooks,
  // ADR-0020: `workflows` retired — record state machines are a
  // `state_machine` validation rule on the object (see
  // src/objects/opportunity.object.ts). One flow only: the convert-lead
  // screen wizard the smoke test drives.
  flows: allFlows,

  // Security
  positions: [SalesRepPosition, SalesManagerPosition, FinanceApproverPosition],
  permissions: [SalesUserPermissionSet, GuestPortalProfile],
  sharingRules: [
    HighValueOpportunitySharingRule,
    RepLeadSharingRule,
    WonDealActivitySharingRule,
  ],

  // Seed data
  data: CrmSeedData,
});

/**
 * [#8060] Ensure the persona position↔permission-set bindings exist after the
 * security bootstraps (cannot be a seed — see bind-position-sets.ts). Mirrors
 * app-showcase's own `onEnable` wiring.
 */
export const onEnable = async (ctx: unknown): Promise<void> => {
  registerCrmPositionBindings(ctx as Parameters<typeof registerCrmPositionBindings>[0]);
};
