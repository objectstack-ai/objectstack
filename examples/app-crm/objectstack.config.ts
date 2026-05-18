// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import * as cubes from './src/cubes';

import * as objects from './src/objects';
import * as actions from './src/actions';
import * as dashboards from './src/dashboards';
import * as reports from './src/reports';
import { allFlows } from './src/flows';
import { allAgents } from './src/agents';
import { allSkills } from './src/skills';
import * as ragPipelines from './src/rag';
import * as profiles from './src/profiles';
import * as apps from './src/apps';
import * as views from './src/views';
import * as approvals from './src/approvals';
import * as translations from './src/translations';
import { CrmSeedData } from './src/data';

import {
  AccountTeamSharingRule, TerritorySharingRules,
  OpportunitySalesSharingRule,
  CaseEscalationSharingRule,
  RoleHierarchy,
} from './src/sharing';

import { allHooks } from './src/hooks';

export default defineStack({
  manifest: {
    id: 'com.example.crm',
    namespace: 'crm',
    version: '3.0.0',
    type: 'app',
    name: 'Enterprise CRM',
    description: 'Comprehensive enterprise CRM demonstrating all ObjectStack Protocol features including AI, security, and automation',
  },

  // ─── Platform capabilities this app needs ─────────────────────────
  // The runtime resolves each capability name to a built-in service plugin
  // and auto-loads it (with extras like Automation's node packs). No need
  // to hand-instantiate plugins or pass `--preset` flags. See
  // packages/cli/src/commands/serve.ts CAPABILITY_PROVIDERS for the
  // complete map; explicit `plugins: [...]` always shadows the resolver.
  // `auth` enables /api/v1/auth/* (login/register) via @objectstack/plugin-auth.
  // `ui`   serves the Studio shell and CRM apps under /_studio/.
  // Both are required for a clickable login flow when running `objectstack start`
  // off the compiled artifact.
  requires: ['ai', 'automation', 'analytics', 'auth', 'ui', 'storage', 'approvals'],

  objects: Object.values(objects),
  actions: Object.values(actions),
  dashboards: Object.values(dashboards),
  reports: Object.values(reports),
  flows: allFlows,
  agents: allAgents,
  skills: allSkills,
  ragPipelines: Object.values(ragPipelines),
  permissions: Object.values(profiles),
  apps: Object.values(apps),
  views: Object.values(views),
  approvals: Object.values(approvals),
  analyticsCubes: Object.values(cubes),

  hooks: allHooks,

  data: CrmSeedData,

  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN', 'ja-JP', 'es-ES'],
    fallbackLocale: 'en',
    fileOrganization: 'per_locale',
  },

  translations: Object.values(translations),

  sharingRules: [
    AccountTeamSharingRule,
    OpportunitySalesSharingRule,
    CaseEscalationSharingRule,
    ...TerritorySharingRules,
  ],
  roles: RoleHierarchy.roles.map((r: { name: string; label: string; parentRole: string | null }) => ({
    name: r.name,
    label: r.label,
    parent: r.parentRole ?? undefined,
  })),
});
