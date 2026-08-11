// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * My Work — a role-aware workspace home that *composes* live data the way a
 * real landing page does, instead of listing one component per type:
 *   • a KPI hero row of live `object-metric` tiles in an equal-width `grid`;
 *   • a personal work queue — `object-grid` filtered to the signed-in user
 *     via the `{current_user_id}` token (records I own);
 *   • sidebar shortcuts + a card gated by component-level `visibleWhen` (ADR-0089).
 */
export const MyWorkPage = definePage({
  name: 'showcase_my_work',
  label: 'My Work',
  type: 'home',
  template: 'header-sidebar-main',
  isDefault: false,
  kind: 'full',
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        { type: 'page:header', properties: { title: 'My Work', subtitle: 'Your queue, the team’s throughput, and what needs attention.' } },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        // KPI hero ROW — equal-width tiles in a 3-col grid (layout grid, not ObjectGrid).
        {
          type: 'grid',
          properties: {
            columns: 3,
            gap: 4,
            children: [
              { type: 'object-metric', properties: { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'blue', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: { status: { $ne: 'done' } } } },
              { type: 'object-metric', properties: { objectName: 'showcase_task', label: 'In Review', icon: 'eye', colorVariant: 'warning', description: 'awaiting review', aggregate: { field: 'id', function: 'count' }, filter: { status: 'in_review' } } },
              { type: 'object-metric', properties: { objectName: 'showcase_project', label: 'At-Risk Projects', icon: 'alert-triangle', colorVariant: 'danger', description: 'health red', aggregate: { field: 'id', function: 'count' }, filter: { health: 'red' } } },
            ],
          },
        },
        { type: 'element:divider', properties: {} },
        // Personal work queue — records owned by the signed-in user.
        // `filter`, SINGULAR: that is the key `object-grid` both publishes and
        // reads (objectui `plugin-grid/src/index.tsx` declares
        // `{ name: 'filter', … }`; `ObjectGrid.tsx` reads `schema.filter` and
        // lowers it through `toFilterNode` to `$filter`). The plural spelling
        // this line used to carry has ZERO read points in the renderer, so it
        // was accepted and then dropped — the queue silently listed every row
        // (objectstack#7750).
        {
          type: 'object-grid',
          properties: {
            objectName: 'showcase_task',
            columns: ['title', 'project', 'status', 'priority', 'due_date'],
            filter: [['owner_id', '=', '{current_user_id}']],
          },
        },
      ],
    },
    {
      name: 'sidebar',
      width: 'small',
      components: [
        // Shortcuts in a page:card — children now render in a region
        // (the bare `page:card` key is no longer shadowed by the thin layout div).
        {
          type: 'page:card',
          properties: {
            title: 'Shortcuts',
            children: [
              { type: 'element:text', properties: { content: 'Delivery Operations — org-wide KPI dashboard.' } },
              { type: 'element:text', properties: { content: 'Approvals — items awaiting a decision.' } },
              { type: 'element:text', properties: { content: 'New Project (Wizard) — stepped create.' } },
            ],
          },
        },
        // Admin-only card — gated by the ADR-0089 canonical, COMPONENT-LEVEL
        // `visibleWhen`: a sibling of `properties`, never a key inside it.
        // `properties` is the widget's own prop bag (`PageCardProps`), which
        // declares no visibility key; a predicate written there only worked
        // because objectui's SchemaRenderer hoists `properties` onto the node
        // before evaluating, i.e. by accident of the renderer rather than by
        // contract. The predicate binds `current_user` — the identity root
        // ADR-0089 declares for page-component predicates (`record`,
        // `current_user`, `page.<var>`).
        {
          type: 'page:card',
          visibleWhen: "current_user.email == 'admin@objectos.ai'",
          properties: {
            title: 'Leadership View',
            children: [
              { type: 'element:text', properties: { content: 'Admin-only — shown because current_user.email matches the card’s visibleWhen predicate.' } },
            ],
          },
        },
      ],
    },
  ],
});
