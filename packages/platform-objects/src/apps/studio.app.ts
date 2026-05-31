// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform Studio App — static definition.
 *
 * The developer/maker workbench. Studio surfaces every editable
 * metadata type (objects, views, flows, agents, …) — i.e. the
 * "schema-side" of the platform — and is intentionally separate from
 * Setup, which is the operator/admin app for users/permissions/system
 * configuration.
 *
 * The split mirrors the industry convention:
 *   - Salesforce: Setup (admin) ⟷ App Builder + Schema Builder + Flow Builder (developer)
 *   - ServiceNow: System Definition ⟷ Studio
 *   - Microsoft Power Platform: Admin Center ⟷ Maker Portal
 *
 * Rationale:
 *   - Different audience (implementers/devs vs IT admins)
 *   - Different risk surface (schema changes vs user/SSO changes)
 *   - Independent permission gating (`studio.access` vs `setup.access`)
 *   - Different operational cadence (continuous in dev/staging, gated in prod)
 *   - Future home for source-control, change sets, sandbox refresh, deploy
 *
 * Registration: alongside SETUP_APP in plugin-auth, so it ships out of
 * the box whenever the auth/security trio is loaded.
 */

import type { App } from '@objectstack/spec/ui';

export const STUDIO_APP: App = {
  name: 'studio',
  label: 'Studio',
  description: 'Metadata workbench for developers, analysts, and implementers',
  icon: 'hammer',
  active: true,
  isDefault: false,
  // Studio is the metadata-authoring host, so its ambient copilot is
  // pinned to the schema-architect agent. Resolved by the ambient chat
  // endpoint via `app.defaultAgent` — no UI-side `?agent=` override
  // needed. Every other app falls back to the data-query agent.
  defaultAgent: 'metadata_assistant',
  branding: {
    primaryColor: '#6366f1', // Indigo-500 — distinct from Setup's slate
  },
  requiredPermissions: ['studio.access'],
  contextSelectors: [
    {
      // Package scope — pinned to the sidebar header. Selecting a package
      // injects `{active_package}` into every `metadata:resource` nav
      // item below, so the whole workbench filters to that package in
      // one click. Options come from the installed-packages REST surface,
      // narrowed to project-scoped packages: this dropdown exists so
      // third-party developers can scope to *their* custom package, so we
      // deliberately hide the platform's own system/cloud kernel packages
      // (auth, security, audit, queue, …) which are not user-authored.
      id: 'active_package',
      label: 'Package',
      icon: 'package',
      optionsSource: {
        endpoint: '/api/v1/packages',
        valueKey: 'manifest.id',
        labelKey: 'manifest.name',
        filter: [{ key: 'manifest.scope', op: 'nin', value: ['system', 'cloud'] }],
      },
      includeAll: true,
      allValue: '',
      persist: 'query',
      placement: 'sidebar_header',
    },
  ],
  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      icon: 'layout-dashboard',
      children: [
        {
          id: 'nav_metadata_directory',
          type: 'component',
          label: 'All Metadata Types',
          componentRef: 'metadata:directory',
          icon: 'layers',
        },
        {
          id: 'nav_packages',
          type: 'component',
          label: 'Packages',
          componentRef: 'developer:packages',
          icon: 'package',
        },
      ],
    },
    {
      // Data Model — schema-design surfaces. Objects are the primary
      // entry; field management happens in-context on each object's
      // detail form (master-detail), so no top-level field link.
      id: 'group_data_model',
      type: 'group',
      label: 'Data Model',
      icon: 'database',
      children: [
        {
          id: 'nav_objects',
          type: 'component',
          label: 'Objects',
          componentRef: 'metadata:resource',
          params: { type: 'object', package: '{active_package}' },
          icon: 'box',
        },
        {
          id: 'nav_validations',
          type: 'component',
          label: 'Validations',
          componentRef: 'metadata:resource',
          params: { type: 'validation', package: '{active_package}' },
          icon: 'check-square',
        },
      ],
    },
    {
      // User Experience — the metadata that shapes what end users see.
      id: 'group_ux',
      type: 'group',
      label: 'User Experience',
      icon: 'layout',
      children: [
        {
          id: 'nav_apps',
          type: 'component',
          label: 'Apps',
          componentRef: 'metadata:resource',
          params: { type: 'app', package: '{active_package}' },
          icon: 'app-window',
        },
        {
          id: 'nav_views',
          type: 'component',
          label: 'Views',
          componentRef: 'metadata:resource',
          params: { type: 'view', package: '{active_package}' },
          icon: 'table',
        },
        {
          id: 'nav_pages',
          type: 'component',
          label: 'Pages',
          componentRef: 'metadata:resource',
          params: { type: 'page', package: '{active_package}' },
          icon: 'file-text',
        },
        {
          id: 'nav_dashboards',
          type: 'component',
          label: 'Dashboards',
          componentRef: 'metadata:resource',
          params: { type: 'dashboard', package: '{active_package}' },
          icon: 'layout-dashboard',
        },
        {
          id: 'nav_reports',
          type: 'component',
          label: 'Reports',
          componentRef: 'metadata:resource',
          params: { type: 'report', package: '{active_package}' },
          icon: 'bar-chart-3',
        },
      ],
    },
    {
      // Logic — declarative + scripted business rules.
      id: 'group_logic',
      type: 'group',
      label: 'Logic',
      icon: 'function-square',
      children: [
        {
          id: 'nav_actions',
          type: 'component',
          label: 'Actions',
          componentRef: 'metadata:resource',
          params: { type: 'action', package: '{active_package}' },
          icon: 'mouse-pointer-click',
        },
        {
          id: 'nav_hooks',
          type: 'component',
          label: 'Hooks',
          componentRef: 'metadata:resource',
          params: { type: 'hook', package: '{active_package}' },
          icon: 'webhook',
        },
      ],
    },
    {
      // Automation — flows, declarative workflow rules, approval processes.
      id: 'group_automation',
      type: 'group',
      label: 'Automation',
      icon: 'workflow',
      children: [
        {
          id: 'nav_flows',
          type: 'component',
          label: 'Flows',
          componentRef: 'metadata:resource',
          params: { type: 'flow', package: '{active_package}' },
          icon: 'git-branch',
        },
        {
          id: 'nav_workflows',
          type: 'component',
          label: 'Workflow Rules',
          componentRef: 'metadata:resource',
          params: { type: 'workflow', package: '{active_package}' },
          icon: 'zap',
        },
        // ADR-0019: no standalone "Approval Processes" nav — approvals are
        // authored as Approval nodes inside a Flow (see nav_flows above).
      ],
    },
    {
      // AI — agent/tool/skill metadata. Configured together by the
      // same team in practice; runtime conversations live in their
      // own app surface, not here.
      id: 'group_ai',
      type: 'group',
      label: 'AI',
      icon: 'sparkles',
      children: [
        {
          id: 'nav_agents',
          type: 'component',
          label: 'Agents',
          componentRef: 'metadata:resource',
          params: { type: 'agent', package: '{active_package}' },
          icon: 'bot',
        },
        {
          id: 'nav_tools',
          type: 'component',
          label: 'Tools',
          componentRef: 'metadata:resource',
          params: { type: 'tool', package: '{active_package}' },
          icon: 'wrench',
        },
        {
          id: 'nav_skills',
          type: 'component',
          label: 'Skills',
          componentRef: 'metadata:resource',
          params: { type: 'skill', package: '{active_package}' },
          icon: 'brain',
        },
      ],
    },
    {
      // Developer — first-party developer tooling surfaces hosted by the
      // console (API console, flow run inspector, public forms registry).
      // Registered as built-in components in the console's
      // ComponentRegistry under the `developer:*` namespace.
      id: 'group_developer',
      type: 'group',
      label: 'Developer',
      icon: 'terminal',
      children: [
        {
          id: 'nav_api_console',
          type: 'component',
          label: 'API Console',
          componentRef: 'developer:api-console',
          icon: 'terminal',
        },
        {
          id: 'nav_flow_runs',
          type: 'component',
          label: 'Flow Runs',
          componentRef: 'developer:flow-runs',
          icon: 'activity',
        },
        {
          id: 'nav_public_forms',
          type: 'component',
          label: 'Public Forms',
          componentRef: 'developer:public-forms',
          icon: 'file-text',
        },
      ],
    },
    {
      // Integration — outbound shapes: datasources, email templates,
      // routes/functions/services live here too once they have CRUD
      // surfaces. Email templates are a developer artefact (templates
      // referenced by transactional sends), not a Setup item.
      id: 'group_integration',
      type: 'group',
      label: 'Integration',
      icon: 'plug',
      children: [
        {
          id: 'nav_email_templates',
          type: 'component',
          label: 'Email Templates',
          componentRef: 'metadata:resource',
          params: { type: 'email_template', package: '{active_package}' },
          icon: 'mail',
        },
      ],
    },
  ],
};
