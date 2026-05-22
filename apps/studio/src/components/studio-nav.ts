// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio top-level navigation registry — drives the flat sidebar and the
 * Cmd+K command palette. Inspired by Power Apps' fixed left rail and
 * Salesforce Setup's "Object Manager" pattern: the sidebar lists *jobs*
 * (Objects, Forms, Automations, …), not a tree of every metadata item.
 *
 * Each top-level area maps to a route under `/$package/`.
 */

import {
  Home,
  Package,
  FormInput,
  AppWindow,
  Workflow,
  Bot,
  Shield,
  Globe,
  FlaskConical,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

export interface StudioNavItem {
  /** Stable key (also used as the URL segment under /$package/). */
  key: string;
  /** Display label in sidebar + command palette. */
  label: string;
  /** Lucide icon component. */
  icon: LucideIcon;
  /** Metadata types this entry surfaces (drives list pages + facets). */
  types: string[];
  /** One-line description shown in tooltip + palette. */
  hint: string;
}

/**
 * Top-level navigation areas. Order matches the sidebar.
 *
 * "Home" is special — it uses an empty `types` array because its route is
 * `/$package` (no trailing segment).
 */
export const STUDIO_NAV: readonly StudioNavItem[] = [
  {
    key: 'home',
    label: 'Home',
    icon: Home,
    types: [],
    hint: 'Project overview & quick links',
  },
  {
    key: 'objects',
    label: 'Objects',
    icon: Package,
    types: ['object'],
    hint: 'Data model — tables, fields, relations',
  },
  {
    key: 'forms',
    label: 'Forms',
    icon: FormInput,
    types: ['view'], // filtered to viewType=form
    hint: 'Public + internal forms with publish controls',
  },
  {
    key: 'views',
    label: 'Views & Apps',
    icon: AppWindow,
    types: ['view', 'app', 'page', 'dashboard', 'report'],
    hint: 'Grids, kanbans, dashboards, app navigation',
  },
  {
    key: 'automations',
    label: 'Automations',
    icon: Workflow,
    types: ['flow', 'workflow', 'approval', 'hook', 'trigger', 'function'],
    hint: 'Flows, workflows, hooks, triggers, functions',
  },
  {
    key: 'ai',
    label: 'AI',
    icon: Bot,
    types: ['agent', 'tool', 'skill'],
    hint: 'Agents, tools, skills',
  },
  {
    key: 'security',
    label: 'Security',
    icon: Shield,
    types: ['role', 'profile', 'permission'],
    hint: 'Roles, profiles, permissions',
  },
  {
    key: 'apis',
    label: 'APIs',
    icon: Globe,
    types: [],
    hint: 'REST endpoints auto-generated from objects, forms, flows & AI',
  },
  {
    key: 'playground',
    label: 'Playground',
    icon: FlaskConical,
    types: [],
    hint: 'Try REST, ObjectQL, formulas, forms & agents live',
  },
  {
    key: 'logs',
    label: 'Logs',
    icon: ScrollText,
    types: [],
    hint: 'Request log · event log · audit trail',
  },
] as const;

/** Look up the nav item that owns a given metadata type. Returns null if none. */
export function navItemForType(type: string): StudioNavItem | null {
  return STUDIO_NAV.find((item) => item.types.includes(type)) ?? null;
}

/**
 * Display labels for individual metadata types (singular, Title-Cased).
 *
 * Used by the metadata list pages' filter chips, the breadcrumb, and the
 * inspector header. Distinct from {@link STUDIO_NAV} entries, which are
 * *nav categories* that group multiple types ("Views & Apps" = view + app
 * + page + dashboard + report).
 */
export const METADATA_TYPE_LABELS: Record<string, string> = {
  object: 'Object',
  view: 'View',
  app: 'App',
  page: 'Page',
  dashboard: 'Dashboard',
  report: 'Report',
  flow: 'Flow',
  workflow: 'Workflow',
  approval: 'Approval',
  hook: 'Hook',
  trigger: 'Trigger',
  function: 'Function',
  agent: 'Agent',
  tool: 'Tool',
  skill: 'Skill',
  role: 'Role',
  profile: 'Profile',
  permission: 'Permission',
  policy: 'Policy',
  action: 'Action',
  api: 'API',
  webhook: 'Webhook',
  connector: 'Connector',
  mapping: 'Mapping',
  theme: 'Theme',
  ragPipeline: 'RAG Pipeline',
  sharingRule: 'Sharing Rule',
  analyticsCube: 'Analytics Cube',
  data: 'Seed Data',
};

/**
 * Get a friendly singular display label for a metadata type, e.g.
 * `'app' → 'App'`. Falls back to a capitalised version of the raw key.
 */
export function typeLabel(type: string): string {
  return METADATA_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}
