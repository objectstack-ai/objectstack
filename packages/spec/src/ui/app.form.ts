// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Authoring layout for the `app` metadata type.
 *
 * Eight controls used to sit here for keys `AppSchema` had already retired to
 * `retiredKey()` tombstones in 17.0.0 (#5280). A tombstone is
 * `z.never().optional()`: it keeps the key in the schema's shape on purpose —
 * so the removal can carry its own upgrade prescription — while rejecting every
 * value. Offering one is therefore worse than the #3786 drift this file's
 * reconciliation gate was built for: the author does not lose the value
 * silently, the whole save fails with a 422 for a control that should not have
 * been on screen.
 *
 * Each removal is noted in place below with where the capability went. The gate
 * now judges `key ∈ shape AND not a tombstone`, so the next `retiredKey()`
 * retirement that forgets this file fails
 * `metadata-form-zod-reconciliation.test.ts` instead of reaching an author.
 */

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
        // `version` removed: tombstoned on AppSchema in 17.0.0 (2026-06 liveness
        // audit) — an app is versioned by its owning package's `manifest.version`,
        // and a second per-app number had no reader to disagree with.
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
        // `homePageId` removed: tombstoned in 17.0.0 (#4667, #4709, ADR-0049) —
        // an app's landing page IS its first `navigation` item by `order`, and
        // the root landing follows `isDefault`. Reorder the nav instead.
        // `mobileNavigation` removed: tombstoned in 17.0.0 (2026-06 liveness
        // audit) — fully unimplemented, no renderer including `packages/mobile`
        // ever read it. The block returns if a real mobile navigation ships.
      ],
    },
    {
      label: 'Content',
      description: 'Ambient assistant binding. Objects and endpoints are declared on the stack, not the app.',
      fields: [
        // `objects` removed: tombstoned in 17.0.0 (2026-06 liveness audit) —
        // objects belong to the stack (`defineStack({ objects })`) and an app
        // reaches them through its navigation items (`collectNavObjects`).
        // `apis` removed: tombstoned in 17.0.0 — declarative endpoints are
        // declared one level up as well (`defineStack({ apis })`), where they
        // execute from protocol 17 under the ADR-0121 publish gates (#5040).
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
      description: 'Who can access this app. Public access and embedding are per form view, not app-level.',
      collapsible: true,
      collapsed: true,
      fields: [
        { field: 'requiredPermissions', widget: 'string-tags', helpText: 'Permissions needed to access this app' },
        // `sharing` / `embed` removed: both tombstoned in 17.0.0 (2026-06
        // liveness audit / ADR-0049) — no public-app or iframe route ever read
        // the app-level blocks, so authoring them created a false security
        // impression. The live surface is `FormView.sharing` (public data
        // collection), authored per form view.
        // `aria` removed: tombstoned in 17.0.0 — no renderer read app-level ARIA
        // attributes; declare `aria` on the page component that renders the
        // DOM node (`page.components[].aria`). NOT on a dashboard widget —
        // `dashboard.widgets[].aria` was retired in the same major (#5010,
        // corrected in #6756).
      ],
    },
  ],
});
