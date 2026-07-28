// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineForm } from './view.zod';

export const appForm = defineForm({
  schemaId: 'app',
  type: 'simple',
  sections: [
    {
      label: 'Basics',
      description: 'App identity and activation.',
      columns: 2,
      fields: [
        { field: 'name', type: 'text', required: true, colSpan: 1, helpText: 'snake_case, unique' },
        { field: 'label', type: 'text', required: true, colSpan: 1 },
        { field: 'description', type: 'textarea', colSpan: 2 },
        { field: 'version', type: 'text', colSpan: 1 },
        { field: 'icon', type: 'text', colSpan: 1, helpText: 'Lucide icon name (e.g. "users", "briefcase")' },
        { field: 'active', type: 'boolean', colSpan: 1 },
        { field: 'isDefault', type: 'boolean', colSpan: 1, helpText: 'Make this the default app for new users' },
      ],
    },
    {
      label: 'Navigation',
      description: 'Sidebar items and area grouping.',
      fields: [
        { field: 'navigation', type: 'composite', helpText: 'Nav tree — recursive structure' },
        { field: 'areas', type: 'repeater', helpText: 'Group items into collapsible areas' },
        { field: 'homePageId', type: 'text', helpText: 'Landing page when app opens' },
        { field: 'mobileNavigation', type: 'composite', helpText: 'Bottom tab bar config for mobile' },
      ],
    },
    {
      label: 'Content',
      description: 'Objects and APIs this app uses.',
      fields: [
        { field: 'objects', widget: 'object-selector', multiple: true, helpText: 'Object names this app exposes' },
        { field: 'apis', type: 'composite', helpText: 'API endpoint definitions' },
        { field: 'defaultAgent', type: 'text', helpText: "Platform agent for the ambient assistant ('ask' by default; 'build' for authoring surfaces)" },
      ],
    },
    {
      label: 'Branding',
      description: 'Theme colors and logo.',
      collapsible: true,
      collapsed: true,
      fields: [{ field: 'branding', type: 'composite', helpText: 'Primary/secondary colors, logo, theme' }],
    },
    {
      label: 'Access & sharing',
      description: 'Who can access this app and how it can be embedded.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'requiredPermissions', widget: 'string-tags', helpText: 'Permissions needed to access this app' },
        { field: 'sharing', type: 'composite', helpText: 'Public/internal/restricted access control' },
        { field: 'embed', type: 'composite', helpText: 'iFrame embed configuration' },
        { field: 'aria', type: 'composite', helpText: 'Accessibility labels' },
      ],
    },
  ],
});
