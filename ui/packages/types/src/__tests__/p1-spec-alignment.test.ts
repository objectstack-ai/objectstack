/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * P1 Spec Protocol Alignment Tests
 * Tests for all P1 sub-items: ListView, FormView, Dashboard, Page, Record Components, i18n/ARIA
 */
import { describe, it, expect } from 'vitest';
// The one runtime import in this otherwise type-only file: the retirement pin
// below had to read a zod shape when written, because the TS interfaces here
// inherited `BaseSchema`'s `[key: string]: any` (until objectui#8347) and could
// not reject a key.
import { ObjectGridSchema as ObjectGridZodSchema } from '../zod/index.zod';
import type {
  // P1.1 ListView types
  ListViewSchema,
  ObjectGridSchema,
  ObjectViewSchema,
  // P1.2 FormView types
  ObjectFormSchema,
  ObjectFormSection,
  // P1.3 Dashboard types
  DashboardWidgetSchema,
  DashboardComponentSchema,
  // P1.4 Page types
  PageType,
  PageVariable,
  PageNodeSchema,
  // P1.5 Record component types
  RecordDetailsComponentProps,
  RecordHighlightsComponentProps,
  RecordRelatedListComponentProps,
  RecordActivityComponentProps,
  RecordChatterComponentProps,
  RecordPathComponentProps,
} from '../index';

// ============================================================================
// P1.1 ListView Spec Alignment
// ============================================================================
describe('P1.1 ListView Spec Alignment', () => {
  it('should accept rowActions and bulkActions as string arrays', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      rowActions: ['edit', 'delete', 'clone'],
      bulkActions: ['delete', 'assign', 'export'],
    };
    expect(schema.rowActions).toHaveLength(3);
    expect(schema.bulkActions).toHaveLength(3);
  });

  it('should accept spec-canonical bulkActions on ObjectGridSchema (#1763)', () => {
    const schema: ObjectGridSchema = {
      type: 'object-grid',
      objectName: 'Account',
      bulkActions: ['delete', 'assign'],
      batchActions: ['delete'],
    };
    expect(schema.bulkActions).toHaveLength(2);
    expect(schema.batchActions).toHaveLength(1);
  });

  // objectstack#7176 (maintainer-ruled 2026-08-10) retired `striped`,
  // `bordered` and `virtualScroll` from the spec's list view after measuring
  // every objectui reader as pass-through — the value was relayed and no
  // renderer ever applied it. objectui#4649 took the chain out. An acceptance
  // case for `virtualScroll` stood here; it is replaced rather than deleted,
  // because the risk this file guards against is a well-meaning re-add.
  //
  // Asserted on objectui's OWN types (`ObjectGridSchema`, `NamedListView`) on
  // purpose. Those are objectui-owned, so the claim is pin-independent and
  // holds on the rc.6 pin and on GA alike. The spec-derived `ListViewSchema`
  // could not carry it: on rc.6 the three still exist upstream and ride in
  // through the by-reference spec-field import (see `objectql.zod.ts`), so
  // "absent from ListViewSchema" is simply false today. That import is also
  // what makes an objectui-side assertion unnecessary there — on the GA bump
  // the spec's own `retiredKey()` tombstones arrive with it and do the
  // rejecting, which is the protocol's job, not this repo's.
  // Asserted against the ZOD ObjectGrid schema, not the TS interface, and that
  // was forced rather than stylistic when written: `ObjectGridSchema` extends
  // `BaseSchema`, which carried `[key: string]: any` for type-specific
  // extensions until objectui#8347, so no interface in that family could reject
  // an excess key. Measured — the `@ts-expect-error` first written here failed
  // as TS2578 "unused directive", i.e. the type still admitted `virtualScroll`
  // then. The
  // zod shape is the surface that can actually say no, and it is objectui's
  // own, so the claim holds on the rc.6 pin and on GA alike.
  it('should no longer declare the retired keys on the ObjectGrid zod schema', () => {
    const declared = Object.keys(ObjectGridZodSchema.shape);

    expect(declared).not.toContain('striped');
    expect(declared).not.toContain('bordered');
    expect(declared).not.toContain('virtualScroll');
    // Anchors the read: a renamed or restructured shape would otherwise make
    // the three absences vacuously true.
    expect(declared).toContain('resizable');
  });

  it('should accept showRecordCount and allowPrinting', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      showRecordCount: true,
      allowPrinting: true,
    };
    expect(schema.showRecordCount).toBe(true);
    expect(schema.allowPrinting).toBe(true);
  });

  it('should accept userActions configuration', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      userActions: {
        sort: true,
        search: true,
        filter: true,
        rowHeight: false,
        addRecordForm: true,
        buttons: ['custom_action_1'],
      },
    };
    expect(schema.userActions?.sort).toBe(true);
    expect(schema.userActions?.buttons).toEqual(['custom_action_1']);
  });

  it('should accept appearance configuration', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      appearance: {
        showDescription: true,
        allowedVisualizations: ['grid', 'kanban'],
      },
    };
    expect(schema.appearance?.showDescription).toBe(true);
    expect(schema.appearance?.allowedVisualizations).toHaveLength(2);
  });

  it('authors a named preset as a `listViews` entry, not as the retired list-view `tabs`', () => {
    // objectstack#20357 retired the list view's own `tabs` (`ViewTabSchema[]`)
    // as a `retiredKey()` tombstone: on spec `main` its input type is `never`,
    // so the fixture that authored it here stopped compiling on the Spec Main
    // Shape Gate (objectui#10987). No fixture may author it: the installed
    // spec still admits the key and spec `main` refuses it, so neither an
    // accept nor a refusal compiles on both until the pin bump.
    // This is the protocol's prescription instead: each tab becomes a named view
    // under the object's `listViews`. The tab's `name` is the entry's key, its
    // `label` the entry's `label`, its `filter` rules the entry's `filter`, and
    // the entry declares its own `columns`. `defaultListView` names the view the
    // tab's `isDefault` picked. Every entry renders as a tab in the saved-view
    // switcher.
    const schema: ObjectViewSchema = {
      type: 'object-view',
      objectName: 'Account',
      defaultListView: 'all',
      listViews: {
        all: { label: 'All Records', columns: ['name'] },
        mine: {
          label: 'My Records',
          columns: ['name'],
          filter: [{ field: 'owner', operator: 'equals', value: 'current_user' }],
        },
      },
    };
    expect(Object.keys(schema.listViews ?? {})).toEqual(['all', 'mine']);
    expect(schema.listViews?.mine?.filter).toHaveLength(1);
    expect(schema.defaultListView).toBe('all');
  });

  it('should accept addRecord configuration', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      addRecord: {
        enabled: true,
        position: 'top',
      },
    };
    expect(schema.addRecord?.enabled).toBe(true);
  });

  it('should accept ObjectGridSchema with spec-aligned conditionalFormatting and emptyState', () => {
    const schema: ObjectGridSchema = {
      type: 'object-grid',
      objectName: 'Account',
      conditionalFormatting: [
        { condition: '${data.amount > 10000}', style: { backgroundColor: '#fee2e2' } },
      ],
      emptyState: { title: 'No Records', message: 'Create your first account', icon: 'Database' },
      // The spec's row / bulk action slots are `rowActions` / `bulkActions`.
      // `rowSpecActions` / `bulkSpecActions` were second spellings of them that
      // nothing read, retired by objectui#11068.
      rowActions: ['edit', 'delete'],
      bulkActions: ['delete', 'export'],
    };
    expect(schema.conditionalFormatting).toHaveLength(1);
    expect(schema.emptyState?.title).toBe('No Records');
    expect(schema.rowActions).toEqual(['edit', 'delete']);
  });

  // P2: Sharing / ExportOptions / Pagination protocol alignment tests
  it('should accept sharing in spec format { type, lockedBy }', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      sharing: {
        type: 'collaborative',
        lockedBy: 'admin@example.com',
      },
    };
    expect(schema.sharing?.type).toBe('collaborative');
    expect(schema.sharing?.lockedBy).toBe('admin@example.com');
  });

  // (framework#4074) The two "sharing in ObjectUI format { visibility, enabled }"
  // tests that sat here were deleted rather than made to pass. The legacy pair is
  // real, but it is a NORMALIZER INPUT dialect, not part of `ListViewSchema`:
  // `normalizeListViewSchema` (`@object-ui/core`) folds `visibility`/`enabled`
  // onto the spec's `ViewSharing.type` at the ListView boundary, and ITS suite
  // asserts every branch of that fold at the seam where it actually runs
  // (`normalize-list-view.test.ts` — "collapses the visibility audience onto the
  // spec ownership type", the bare-`enabled` mapping, `lockedBy` preservation,
  // explicit-`type` precedence). Asserting the dialect on this type instead only
  // ever "passed" because nothing compiled this file (objectui#3009) — and
  // widening the canonical type to advertise a dialect that already has a fold
  // would invite new metadata to author it.

  it('should accept exportOptions as spec string[] format', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      exportOptions: ['csv', 'xlsx'],
    };
    expect(Array.isArray(schema.exportOptions)).toBe(true);
    expect(schema.exportOptions).toEqual(['csv', 'xlsx']);
  });

  it('should accept exportOptions as ObjectUI object format', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      exportOptions: {
        formats: ['csv', 'json'],
        maxRecords: 5000,
        includeHeaders: true,
        fileNamePrefix: 'accounts_export',
      },
    };
    expect(Array.isArray(schema.exportOptions)).toBe(false);
    const opts = schema.exportOptions as { formats?: string[]; maxRecords?: number };
    expect(opts.formats).toEqual(['csv', 'json']);
    expect(opts.maxRecords).toBe(5000);
  });

  it('should accept pagination with pageSizeOptions', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      pagination: {
        pageSize: 25,
        pageSizeOptions: [10, 25, 50, 100],
      },
    };
    expect(schema.pagination?.pageSize).toBe(25);
    expect(schema.pagination?.pageSizeOptions).toEqual([10, 25, 50, 100]);
  });
});

// ============================================================================
// P1.2 FormView Spec Alignment
// ============================================================================
describe('P1.2 FormView Spec Alignment', () => {
  it('should accept all formType variants', () => {
    const formTypes: Array<ObjectFormSchema['formType']> = [
      'simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal',
    ];
    formTypes.forEach((formType) => {
      const schema: ObjectFormSchema = {
        type: 'object-form',
        objectName: 'Account',
        mode: 'create',
        formType,
      };
      expect(schema.formType).toBe(formType);
    });
  });

  it('should accept FormSection with 1-4 column layout', () => {
    const columns: Array<ObjectFormSection['columns']> = [1, 2, 3, 4];
    columns.forEach((col) => {
      const section: ObjectFormSection = {
        label: 'Basic Info',
        columns: col,
        fields: ['name', 'email'],
        collapsible: true,
        collapsed: false,
      };
      expect(section.columns).toBe(col);
    });
  });

  it('accepts the `sections[].group` REFERENCE form on a FORM section, and `fields` without it (objectui#7051)', () => {
    // The view-level half of objectstack#13855, the sibling of the
    // `record:details` pin further down this file (objectui#8497).
    // `@objectstack/spec` 17.3.0's `FormSectionSchema` declares two ways to
    // give a section its members — enumerate `fields`, or point `group` at one
    // of the object's declared `fieldGroups` — and refuses a section carrying
    // neither or both. `ObjectFormSection` required `fields` and declared no
    // `group`, so the spec-legal shape did not COMPILE for a TypeScript author
    // while `ObjectForm` read the key nowhere: declared on one side, absent on
    // the other, in both directions at once.
    //
    // ⚠️ This is a COMPILE-time assertion first — the annotation does the work,
    // which is why `type-check` and not `test` is the instrument that can fail
    // it. Measured on this very literal while writing it: with `group`
    // undeclared, `pnpm --filter @object-ui/types type-check` reported
    // `TS2353`/`TS2739` here while `vitest` stayed GREEN, because vitest strips
    // types. The runtime expectations below exist only so the leg also fails
    // visibly if the shape is ever silently emptied.
    const sections: ObjectFormSection[] = [
      { group: 'contact_info' },
      // `columns` and `pane` are the two keys the spec PERMITS beside `group`:
      // they describe how this form lays the section out, not anything the
      // group declares.
      { group: 'billing', columns: 2, pane: 'secondary' },
      { name: 'audit', label: 'Audit', fields: ['created_at'] },
    ];
    expect(sections).toHaveLength(3);
    expect(sections[0]).toEqual({ group: 'contact_info' });
    // The enumerated arm still carries its members — a `fields` that became
    // optional must not have become absent.
    expect(sections[2].fields).toEqual(['created_at']);
  });

  it('should accept FormField properties: widget, dependsOn, visibleOn, colSpan', () => {
    const schema: ObjectFormSchema = {
      type: 'object-form',
      objectName: 'Account',
      mode: 'edit',
      customFields: [
        {
          name: 'industry',
          label: 'Industry',
          type: 'select',
          widget: 'industry-picker',
        },
        {
          name: 'sub_industry',
          label: 'Sub-Industry',
          type: 'select',
          dependsOn: ['industry'],
          visibleOn: '${data.industry != null}',
          colSpan: 2,
        },
      ],
    };
    expect(schema.customFields).toHaveLength(2);
    expect(schema.customFields![1].dependsOn).toEqual(['industry']);
    expect(schema.customFields![1].visibleOn).toBe('${data.industry != null}');
    expect(schema.customFields![1].colSpan).toBe(2);
  });
});

// ============================================================================
// P1.3 Dashboard Spec Alignment
// ============================================================================
describe('P1.3 Dashboard Spec Alignment', () => {
  it('should accept widget dataset binding properties (ADR-0021)', () => {
    const widget: DashboardWidgetSchema = {
      // `bar`, not `bar-chart`. This fixture said `bar-chart` until objectui#4600
      // closed the widget `type` vocabulary and tsc reported it: `bar-chart` is a
      // `plugin-charts` COMPONENT type, not a widget visualization family, and the
      // spec's family for this chart is `bar`. A dataset-bound widget naming it
      // never reaches `DatasetWidget` — `classifyWidgetType` returns `passthrough`
      // — so the fixture was pinning a shape that cannot render what it describes.
      // The assertions below are about the ADR-0021 dataset binding and are
      // unaffected by the spelling.
      type: 'bar',
      title: 'Revenue by Region',
      filter: [['stage', '=', 'Closed Won']],
      dataset: 'opportunity_metrics',
      dimensions: ['region'],
      values: ['amount'],
    };
    expect(widget.dataset).toBe('opportunity_metrics');
    expect(widget.dimensions).toEqual(['region']);
    expect(widget.values).toEqual(['amount']);
  });

  it('should accept widget color variants', () => {
    const variants: Array<DashboardWidgetSchema['colorVariant']> = [
      'default', 'blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger',
    ];
    variants.forEach((variant) => {
      const widget: DashboardWidgetSchema = {
        type: 'metric',
        title: 'Test',
        colorVariant: variant,
      };
      expect(widget.colorVariant).toBe(variant);
    });
  });

  it('should accept dataset-bound pivot widgets (matrix)', () => {
    const widget: DashboardWidgetSchema = {
      type: 'pivot',
      title: 'Sales Matrix',
      dataset: 'sales_metrics',
      dimensions: ['region', 'quarter'],
      values: ['total_amount', 'deal_count'],
    };
    expect(widget.values).toEqual(['total_amount', 'deal_count']);
    expect(widget.dimensions).toHaveLength(2);
  });

  it('should accept globalFilters with optionsFrom', () => {
    const dashboard: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [],
      globalFilters: [
        {
          field: 'region',
          label: 'Region',
          type: 'select',
          optionsFrom: {
            object: 'Region',
            valueField: 'id',
            labelField: 'name',
          },
          targetWidgets: ['widget-0', 'widget-1'],
        },
      ],
    };
    expect(dashboard.globalFilters).toHaveLength(1);
    expect(dashboard.globalFilters![0].optionsFrom?.object).toBe('Region');
  });

  it('should accept date range filter', () => {
    const dashboard: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [],
      dateRange: {
        field: 'created_at',
        defaultRange: 'last_30_days',
        allowCustomRange: true,
      },
    };
    expect(dashboard.dateRange?.defaultRange).toBe('last_30_days');
    expect(dashboard.dateRange?.allowCustomRange).toBe(true);
  });

  it('should accept DashboardHeader with actions', () => {
    // `header` is the spec's `DashboardHeader` by reference (objectui#7759), so
    // `actionUrl` is required, `actionType` is the spec's `ActionType` enum and
    // `label` is an `I18nLabel`. The first action here used to read
    // `{ label: 'Refresh', actionType: 'refresh' }` — legal only under the
    // hand-written restatement this file pinned, refused by the spec and by the
    // zod mirror alike (no `actionUrl`, and `refresh` is not an action type).
    const dashboard: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [],
      header: {
        showTitle: true,
        showDescription: false,
        actions: [
          { label: { en: 'Run forecast', 'zh-CN': '运行预测' }, actionUrl: 'run_forecast', actionType: 'flow', icon: 'Play' },
          { label: 'Export', actionUrl: '/api/export', icon: 'Download' },
        ],
      },
    };
    expect(dashboard.header?.showTitle).toBe(true);
    expect(dashboard.header?.actions).toHaveLength(2);
    // @ts-expect-error — `refresh` is not a member of the spec's `ActionType`.
    const refused: DashboardComponentSchema = { type: 'dashboard', widgets: [], header: { actions: [{ label: 'Refresh', actionUrl: 'x', actionType: 'refresh' }] } };
    expect(refused.type).toBe('dashboard');
  });

  // `should accept widget ARIA properties` REMOVED: `dashboard.widgets[].aria`
  // was retired in @objectstack/spec 17.0.0-rc.3 (objectstack#5010, ADR-0049
  // D2). No renderer ever applied it, so ARIA attributes declared on a widget
  // silently did not reach the DOM — the key promised accessibility compliance
  // it did not deliver, which is exactly why it was removed rather than wired
  // up. This is the same removal the dashboard-level `aria` got at #3896. The
  // dashboard renderer emits its own `aria-*` attributes for the widget grid,
  // so nothing regresses; asserting the key is ACCEPTED would now assert the
  // opposite of the contract.
});

// ============================================================================
// P1.4 Page Composition Spec Alignment
// ============================================================================
describe('P1.4 Page Composition Spec Alignment', () => {
  it('should accept all page types', () => {
    // The roadmap types (dashboard/form/record_detail/record_review/overview/
    // blank) were removed — no renderer, dropped from @objectstack/spec
    // PageTypeSchema (framework#2265). grid/gallery/kanban/calendar/timeline
    // remain pending a separate "visualizations are not page types" cleanup.
    const allTypes: PageType[] = [
      'record', 'home', 'app', 'utility',
      'grid', 'list', 'gallery', 'kanban', 'calendar', 'timeline',
    ];
    allTypes.forEach((type) => {
      const page: PageNodeSchema = {
        type: 'page',
        pageType: type,
      };
      expect(page.pageType).toBe(type);
    });
  });

  it('should accept record_id in PageVariable type', () => {
    const variable: PageVariable = {
      name: 'recordId',
      type: 'record_id',
      source: 'url_param',
    };
    expect(variable.type).toBe('record_id');
    expect(variable.source).toBe('url_param');
  });

  // (Removed "should accept blank page layout" — the `blank` page type and its
  // blankLayout config were dropped: no renderer (framework#2265).)

  it('should accept page ARIA properties', () => {
    const page: PageNodeSchema = {
      type: 'page',
      aria: {
        ariaLabel: 'Account Details Page',
        role: 'main',
      },
    };
    expect(page.aria?.ariaLabel).toBe('Account Details Page');
  });
});

// ============================================================================
// P1.5 Record Components
// ============================================================================
describe('P1.5 Record Components', () => {
  it('should define RecordDetailsComponentProps', () => {
    // `columns` is the STRING `'2'`, not the number, since objectui#8604: the
    // contract declares the body-wide key as `z.enum(['1','2','3','4'])` and
    // refuses `2` with `invalid_value`. The number spelling this literal
    // carried compiled here and was refused at publish — the exact defect the
    // card was filed for. `sections[].columns` one level down keeps `number`
    // (`z.number().int().min(1).max(4)`); the two are pinned side by side in
    // `record-details-columns-8604.test.ts`.
    //
    // `layout` USED TO BE ON THIS LITERAL and was removed with the key in
    // objectui#9040 item 1 — a stated migration, not a green-keeping edit. The
    // contract retired `record:details`'s `layout` in `@objectstack/spec`
    // 17.0.0 (ADR-0087 D2, objectstack#6946) and refuses it BY NAME, so this
    // literal was asserting that a document the platform rejects type-checks.
    // There is no replacement key: the body is chosen by what you author
    // (`sections` renders explicit groups, omitting it falls back to the
    // object's highlightFields). The retirement's own assertions — that the key
    // is gone from this face and still refused by the contract — live in
    // `record-details-top-level-9040.test.ts`; this leg keeps only keys the
    // contract accepts. The `layout` on `RecordHighlightsComponentProps` below
    // is a DIFFERENT key on a different face and deliberately stays.
    const props: RecordDetailsComponentProps = {
      columns: '2',
      sections: [
        { label: 'Basic Info', fields: ['name', 'email', 'phone'], collapsible: true },
        { label: 'Address', fields: ['street', 'city', 'state'], defaultCollapsed: true },
      ],
      fields: ['name', 'email'],
      aria: { ariaLabel: 'Account Details' },
    };
    expect(props.columns).toBe('2');
    expect(props.sections).toHaveLength(2);
    // Replaces the `props.layout` read-back this leg lost to the retirement, so
    // the migration does not quietly shrink what the literal is checked for.
    expect(props.fields).toEqual(['name', 'email']);
  });

  it('accepts the `sections[].group` REFERENCE form, and `fields` without it (objectui#8497)', () => {
    // `@objectstack/spec` 17.3.0 declares two ways to give a section its
    // members: enumerate `fields`, or point `group` at one of the object's
    // declared `fieldGroups` (objectstack#13855, ADR-0085 §5). This type
    // required `fields` and declared no `group`, so the group-reference form
    // — the one `RecordDetailsRenderer` now implements — did not COMPILE for a
    // TypeScript author, which is the same declared-versus-enforced
    // disagreement the card was filed for, pointed the other way.
    //
    // ⚠️ This is a COMPILE-time assertion first: the annotation below is what
    // does the work, and it is the reason `type-check` (not just `test`) has
    // to run for this leg to mean anything. The runtime expectations exist so
    // the leg also fails visibly if the shape is ever silently emptied.
    //
    // ⚠️ Measured while writing this: `{ group: 'terms', columns: 2 }` — a
    // shape `@objectstack/spec` accepts and `DetailSection` honours — does NOT
    // compile, because this interface declares no `columns` (nor `icon`,
    // `description`, `showBorder`, `headerColor`, `defaultCollapsed`). That is
    // a PRE-EXISTING divergence between this type and the spec's section
    // object, not something objectui#8497 introduced, so it is filed rather
    // than widened here. Note also that `vitest` was GREEN on the offending
    // literal — it strips types — and only `type-check` saw it.
    const props: RecordDetailsComponentProps = {
      sections: [
        { group: 'parties' },
        { group: 'terms', collapsible: true },
        { name: 'audit', label: 'Audit', fields: ['created_at'] },
      ],
    };
    expect(props.sections).toHaveLength(3);
    expect(props.sections?.[0]).toEqual({ group: 'parties' });
    // The enumerated arm still carries its members — a `fields` that became
    // optional must not have become absent.
    expect(props.sections?.[2]?.fields).toEqual(['created_at']);
  });

  it('should define RecordHighlightsComponentProps', () => {
    const props: RecordHighlightsComponentProps = {
      fields: ['name', 'status', 'owner', 'amount'],
      layout: 'horizontal',
      aria: { ariaLabel: 'Key Highlights' },
    };
    expect(props.fields).toHaveLength(4);
    expect(props.layout).toBe('horizontal');
  });

  it('should define RecordRelatedListComponentProps', () => {
    const props: RecordRelatedListComponentProps = {
      objectName: 'Contact',
      relationshipField: 'account_id',
      columns: ['name', 'email', 'phone'],
      sort: [{ field: 'name', order: 'asc' }],
      limit: 5,
      // The protocol's rule array (objectui#10199). This fixture used to write
      // an array of `[field, op, value]` tuples, which only compiled because the
      // key was `any`; the spec's `z.array(ViewFilterRuleSchema)` refuses it.
      filter: [{ field: 'active', operator: 'equals', value: true }],
      title: 'Related Contacts',
      showViewAll: true,
      actions: ['new', 'edit'],
      aria: { ariaLabel: 'Related Contacts List' },
    };
    expect(props.objectName).toBe('Contact');
    expect(props.relationshipField).toBe('account_id');
    expect(props.columns).toHaveLength(3);
  });

  it('should define RecordActivityComponentProps', () => {
    const props: RecordActivityComponentProps = {
      types: ['comment', 'email', 'task', 'event'],
      filterMode: 'all',
      showFilterToggle: true,
      limit: 20,
      showCompleted: false,
      unifiedTimeline: true,
      showCommentInput: true,
      enableMentions: true,
      enableReactions: true,
      enableThreading: true,
      showSubscriptionToggle: true,
      aria: { ariaLabel: 'Activity Timeline' },
    };
    expect(props.types).toHaveLength(4);
    expect(props.enableMentions).toBe(true);
    expect(props.unifiedTimeline).toBe(true);
  });

  it('should define RecordChatterComponentProps with feed', () => {
    const props: RecordChatterComponentProps = {
      position: 'right',
      width: '350px',
      collapsible: true,
      defaultCollapsed: false,
      feed: {
        types: ['comment'],
        showCommentInput: true,
        enableMentions: true,
        enableThreading: true,
      },
      aria: { ariaLabel: 'Record Discussion' },
    };
    expect(props.position).toBe('right');
    expect(props.feed?.enableMentions).toBe(true);
  });

  it('should define RecordPathComponentProps', () => {
    const props: RecordPathComponentProps = {
      statusField: 'stage',
      stages: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'qualification', label: 'Qualification' },
        { value: 'proposal', label: 'Proposal' },
        { value: 'closed_won', label: 'Closed Won' },
      ],
      aria: { ariaLabel: 'Opportunity Stage Path' },
    };
    expect(props.statusField).toBe('stage');
    expect(props.stages).toHaveLength(4);
    expect(props.stages[0].value).toBe('prospecting');
  });
});

// ============================================================================
// P1.6 i18n & ARIA Protocol Alignment
// ============================================================================
describe('P1.6 i18n & ARIA Protocol Alignment', () => {
  it('should accept ARIA props on ListViewSchema', () => {
    // Canonical spellings: the spec's AriaProps (`ariaLabel`/`ariaDescribedBy`/
    // `role`) plus objectui's `live` extension. The legacy `label`/`describedBy`
    // spellings this test used to author are a normalizer-input dialect —
    // `normalizeListViewSchema` folds them onto the canonical keys, and core's
    // suite asserts that fold at its own seam (framework#4074).
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      aria: {
        ariaLabel: 'Accounts List',
        ariaDescribedBy: 'accounts-description',
        live: 'polite',
      },
    };
    expect(schema.aria?.ariaLabel).toBe('Accounts List');
    expect(schema.aria?.live).toBe('polite');
  });

  // `should accept ARIA props on DashboardComponentSchema` REMOVED
  // (objectui#5830): the spec removed `dashboard.aria` at the #3896 audit
  // close-out — `DashboardSchema.shape.aria` is a tombstone that refuses any
  // value — and `packages/plugin-dashboard/src` has no `schema.aria` read site
  // (measured for #5742; pinned by that package's
  // `dashboardAuthoredInputs.test.tsx`). The declared member is gone from the
  // TS interface too; had this test stayed, it would have kept passing through
  // `BaseSchema`'s index signature while asserting the opposite of the
  // contract. The removal is pinned by
  // `dashboard-aria-retired-contract-twins.test.ts`.

  it('should accept ARIA props on PageNodeSchema', () => {
    const schema: PageNodeSchema = {
      type: 'page',
      aria: {
        ariaLabel: 'Home Page',
        ariaDescribedBy: 'home-description',
        role: 'main',
      },
    };
    expect(schema.aria?.ariaLabel).toBe('Home Page');
  });
});

// ============================================================================
// NamedListView & ListViewSchema — Toolbar/Display Properties
// ============================================================================
describe('NamedListView toolbar and display properties', () => {
  // objectui#7924 retired the legacy `show*` spellings and the bare `color`
  // shorthand on NamedListView's authoring face; the canonical keys carry the
  // same toolbar toggles and row colouring. The refusal half lives in the
  // census pin (`object-view-unmirrored-keys-7779.test.ts`).
  it('should accept the canonical userActions toggles on NamedListView', () => {
    const view: import('../index').NamedListView = {
      label: 'My View',
      type: 'grid',
      userActions: { search: false, sort: true, filter: false },
    };
    expect(view.userActions?.search).toBe(false);
    expect(view.userActions?.sort).toBe(true);
    expect(view.userActions?.filter).toBe(false);
  });

  it('should accept rowColor (the canonical form of the retired bare color) on NamedListView', () => {
    const view: import('../index').NamedListView = {
      label: 'Styled View',
      type: 'kanban',
      rowColor: { field: 'status' },
    };
    expect(view.rowColor?.field).toBe('status');
  });

  // The other half of the retirement pinned above — `striped` / `bordered` came
  // off `NamedListView` with the same chain (objectstack#7176 / objectui#4649).
  // A stored view definition may still carry them; nothing reads them, and the
  // type no longer admits them.
  it('should no longer declare the retired striped / bordered keys on NamedListView', () => {
    const view: import('../index').NamedListView = {
      label: 'Styled View',
      type: 'kanban',
      // @ts-expect-error - striped is retired (objectstack#7176)
      striped: true,
    };
    const bordered: import('../index').NamedListView = {
      label: 'Styled View',
      type: 'kanban',
      // @ts-expect-error - bordered is retired (objectstack#7176)
      bordered: true,
    };
    expect(view.label).toBe('Styled View');
    expect(bordered.label).toBe('Styled View');
  });

  it('should accept showSearch, showSort, showFilters, color on ListViewSchema', () => {
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'Account',
      showSearch: true,
      showSort: false,
      showFilters: true,
      color: 'priority',
    };
    expect(schema.showSearch).toBe(true);
    expect(schema.showSort).toBe(false);
    expect(schema.showFilters).toBe(true);
    expect(schema.color).toBe('priority');
  });
});
