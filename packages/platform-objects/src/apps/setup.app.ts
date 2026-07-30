// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform Setup App — navigation **shell** (ADR-0029 D7).
 *
 * The Setup App is now a thin shell: it defines the app envelope plus the
 * stable left-nav **group anchors** ("slots"), but enumerates **no** objects.
 * Each capability plugin contributes its own menu entries into a slot via
 * `navigationContributions` (the UI-layer analog of object `extend`), so the
 * menu for an object ships with the package that owns the object.
 *
 * - Items owned by `@objectstack/platform-objects` are contributed by
 *   `SETUP_NAV_CONTRIBUTIONS` (see `setup-nav.contributions.ts`), registered
 *   alongside this app.
 * - Items owned by a capability plugin are contributed by that plugin — e.g.
 *   `@objectstack/plugin-webhooks` fills `group_integrations` with its
 *   `sys_webhook` entry (ADR-0029 K2.a).
 *
 * The runtime merges all contributions into this app's `navigation` tree by
 * group id + priority on read, so the rendered Setup nav is identical to the
 * former static artifact — just assembled from its owners. A disabled
 * capability contributes nothing and its slot stays empty.
 *
 * Menu shape: flat `navigation[]` with `type: 'group'` category nodes,
 * matching the convention used by the HotCRM reference app.
 */

import type { App } from '@objectstack/spec/ui';

export const SETUP_APP: App = {
  name: 'setup',
  label: 'Setup',
  description: 'Platform settings and administration',
  icon: 'settings',
  active: true,
  isDefault: false,
  // ADR-0010 §3.7 — author-facing protection block. Loader translates
  // this into the `_lock` envelope at registration time.
  protection: {
    lock: 'full',
    reason: 'Core admin UI shipped by @objectstack/platform-objects — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  branding: {
    primaryColor: '#475569', // Slate-600 — neutral admin palette
  },
  requiredPermissions: ['setup.access'],
  // Shell only — the stable group anchors. Children are supplied by
  // `navigationContributions` from the packages that own the objects.
  //
  // `expanded: false` is the schema's own default, spelled out: this literal is
  // annotated with the PARSED `App` type, where a `.default()`ed key is
  // required. Omitting it was only possible while `NavigationItem` resolved to
  // `any` and nothing checked these entries at all (#4171).
  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      icon: 'layout-dashboard',
      expanded: false,
      requiredPermissions: ['manage_platform_settings'],
      children: [],
    },
    {
      id: 'group_apps',
      type: 'group',
      label: 'Apps',
      icon: 'package',
      expanded: false,
      children: [],
    },
    {
      id: 'group_people_org',
      type: 'group',
      label: 'People & Organization',
      icon: 'users',
      expanded: false,
      children: [],
    },
    {
      id: 'group_access_control',
      type: 'group',
      label: 'Access Control',
      icon: 'shield',
      expanded: false,
      children: [],
    },
    {
      id: 'group_approvals',
      type: 'group',
      label: 'Approvals',
      icon: 'check-circle',
      expanded: false,
      requiredPermissions: ['manage_platform_settings'],
      children: [],
    },
    {
      id: 'group_configuration',
      type: 'group',
      label: 'Configuration',
      icon: 'sliders-horizontal',
      expanded: false,
      children: [],
    },
    {
      id: 'group_diagnostics',
      type: 'group',
      label: 'Diagnostics',
      icon: 'stethoscope',
      expanded: false,
      requiredPermissions: ['manage_platform_settings'],
      children: [],
    },
    {
      id: 'group_integrations',
      type: 'group',
      label: 'Integrations',
      icon: 'plug',
      expanded: false,
      requiredPermissions: ['manage_platform_settings'],
      children: [],
    },
    {
      id: 'group_advanced',
      type: 'group',
      label: 'Advanced',
      icon: 'wrench',
      expanded: false,
      requiredPermissions: ['manage_platform_settings'],
      children: [],
    },
  ],
};
