/**
 * Tests for Phase 2 Schema Definitions
 * Testing AppSchema, ReportComponentSchema and Enhanced ActionSchema, plus the
 * retirement pins for the theme and block component kinds.
 */
import { describe, it, expect } from 'vitest';
import {
  AppComponentSchema,
  ReportComponentSchema,
  ReportBuilderSchema,
  ActionSchema,
  DetailViewSchema,
  ViewSwitcherSchema,
  FilterUISchema,
  SortUISchema,
  AnyComponentSchema,
  ListViewSchema,
} from '../zod/index.zod';
import type { ActionSchema as CrudActionSchema } from '../crud';

describe('Phase 2: AppComponentSchema Zod Validation', () => {
  it('should validate a complete AppComponentSchema', () => {
    const appConfig = {
      type: 'app',
      name: 'my-crm',
      title: 'My CRM Application',
      description: 'Customer Relationship Management System',
      // The logo's and the favicon's one spelling (objectui#10827,
      // objectui#10842); a top-level `logo` or `favicon` is refused.
      branding: { logo: '/logo.png', favicon: '/favicon.ico' },
      layout: 'sidebar',
      menu: [
        {
          type: 'item',
          label: 'Dashboard',
          icon: 'LayoutDashboard',
          path: '/dashboard',
        },
        {
          type: 'group',
          label: 'Sales',
          children: [
            {
              type: 'item',
              label: 'Leads',
              icon: 'Users',
              path: '/leads',
            },
            {
              type: 'item',
              label: 'Opportunities',
              icon: 'Target',
              path: '/opportunities',
            },
          ],
        },
      ],
      // `actions` is retired on the app node (objectui#7469) and refused by
      // name — see `app-actions-retired-7469.test.ts`. App-level actions are
      // `navigation` items of `type: 'action'`.
      navigation: [
        { id: 'quick_create', type: 'action', label: 'Quick Create', actionDef: { actionName: 'quick_create' } },
      ],
    };

    const result = AppComponentSchema.safeParse(appConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('app');
      expect(result.data.layout).toBe('sidebar');
      expect(result.data.menu).toHaveLength(2);
    }
  });

  it('should validate minimal AppComponentSchema', () => {
    const minimal = {
      type: 'app',
    };

    const result = AppComponentSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('should reject invalid layout value', () => {
    const invalid = {
      type: 'app',
      layout: 'invalid-layout',
    };

    const result = AppComponentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Phase 2: Theme component kinds — retirement pins', () => {
  // ALL theme component kinds are retired:
  //
  // - `type: 'theme'` (`ThemeComponentSchema`) in objectui#5489, under the
  //   maintainer ruling of 2026-08-21 on objectstack#10485 (option B) — a
  //   theme-manager COMPONENT no renderer ever implemented.
  // - `type: 'theme-switcher'` / `'theme-preview'` (`ThemeSwitcherSchema` /
  //   `ThemePreviewSchema`), and `ThemeUnionSchema` itself, in objectui#5647,
  //   by inheritance of the same ruling: the sweep that measured `'theme'`
  //   unregistered measured both siblings identically — zero
  //   `ComponentRegistry.register(...)` / `registerLazy(...)` sites, zero
  //   placeholder entries, zero fixtures.
  //
  // These pins keep them retired: the shapes the old acceptance tests proved
  // VALID are now proven REFUSED, so a re-added kind fails here rather than
  // reappearing silently in the published `@object-ui/types/zod` surface.
  //
  // Attribution note: the objectui#5489 pin proved its refusal sat on the
  // `type` discriminator of `ThemeUnionSchema`; that union is gone with its
  // last two members, so discriminator-level attribution is no longer
  // expressible and the refusals below read `AnyComponentSchema` directly.
  // The control that keeps them meaningful is the positive leg at the end —
  // a still-declared kind parsing GREEN through the same pipeline — so a
  // broken `AnyComponentSchema` cannot read as three successful refusals.
  it('refuses the retired theme component kinds, while a live kind still parses', () => {
    const retiredWrapper = {
      type: 'theme',
      mode: 'dark',
      activeTheme: 'professional',
      themes: [
        {
          name: 'professional',
          label: 'Professional',
          mode: 'auto',
          colors: {
            primary: '#3b82f6',
            secondary: '#64748b',
            background: '#ffffff',
            text: '#0f172a',
          },
          // `fontSize` / `lineHeight` dropped: retired in @objectstack/spec
          // 17.0.0-rc.3 (objectstack#5021), so a theme declaring them is now
          // REFUSED rather than accepted-and-stripped. `fontFamily.base` is the
          // surviving typography key; `customVars` is the door for the rest.
          typography: {
            fontFamily: { base: 'Inter, sans-serif' },
          },
          borderRadius: {
            base: '0.5rem',
            lg: '1rem',
          },
        },
      ],
      allowSwitching: true,
      persistPreference: true,
      storageKey: 'app-theme',
    };

    // The `type: 'theme'` wrapper: gone from every union that used to carry it.
    expect(AnyComponentSchema.safeParse(retiredWrapper).success).toBe(false);

    // The objectui#5647 siblings — these exact shapes are the fixtures the old
    // acceptance tests proved VALID against the retired Zod objects.
    const retiredSwitcher = {
      type: 'theme-switcher',
      variant: 'dropdown',
      showMode: true,
      showThemes: true,
      lightIcon: 'Sun',
      darkIcon: 'Moon',
    };
    expect(AnyComponentSchema.safeParse(retiredSwitcher).success).toBe(false);

    const retiredPreview = {
      type: 'theme-preview',
      showColors: true,
      showTypography: true,
      showComponents: true,
    };
    expect(AnyComponentSchema.safeParse(retiredPreview).success).toBe(false);

    // Positive control on the same pipeline (see the block comment above): a
    // still-declared kind parses GREEN, so the three refusals measure the
    // retirement, not a broken union.
    expect(AnyComponentSchema.safeParse({ type: 'action', label: 'Control Action' }).success).toBe(true);
  });
});

describe('Phase 2: ReportComponentSchema Zod Validation', () => {
  it('should validate a complete ReportComponentSchema', () => {
    const report = {
      type: 'report',
      title: 'Monthly Sales Report',
      description: 'Sales performance for the month',
      fields: [
        {
          name: 'total_sales',
          label: 'Total Sales',
          type: 'number',
          aggregation: 'sum',
          format: 'currency',
        },
        {
          name: 'customer_count',
          label: 'Customers',
          type: 'number',
          aggregation: 'count',
        },
      ],
      filters: [
        {
          field: 'date',
          operator: 'between',
          values: ['2024-01-01', '2024-01-31'],
        },
      ],
      groupBy: [
        {
          field: 'region',
          label: 'Region',
          sort: 'asc',
        },
      ],
      sections: [
        {
          type: 'summary',
          title: 'Summary',
        },
        {
          type: 'chart',
          title: 'Sales Trend',
        },
        {
          type: 'table',
          title: 'Detailed Data',
        },
      ],
      schedule: {
        enabled: true,
        frequency: 'monthly',
        dayOfMonth: 1,
        time: '09:00',
        recipients: ['manager@example.com'],
        formats: ['pdf', 'excel'],
      },
      showExportButtons: true,
      showPrintButton: true,
    };

    const result = ReportComponentSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields).toHaveLength(2);
      expect(result.data.schedule?.frequency).toBe('monthly');
    }
  });

  it('should validate ReportBuilderSchema', () => {
    const builder = {
      type: 'report-builder',
      showPreview: true,
    };

    const result = ReportBuilderSchema.safeParse(builder);
    expect(result.success).toBe(true);
  });

  it('refuses the handler-expression strings this fixture used to prove VALID (objectui#7344)', () => {
    // This test carried `onSave: 'handleSave', onCancel: 'handleCancel'` and
    // asserted green — the string dialect objectui#6182 ruled is not a
    // supported authoring form (2026-08-25), on a `report-builder` no renderer
    // is registered for. Both keys now refuse BY NAME (the objectui#6124 shape;
    // the per-site pin is `handler-keys-string-any-mirrors-7344.test.ts`), so
    // the old fixture is kept here as the negative reading, not deleted.
    const result = ReportBuilderSchema.safeParse({
      type: 'report-builder',
      showPreview: true,
      onSave: 'handleSave',
      onCancel: 'handleCancel',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.code, String(i.path[0])]).sort()).toEqual([
      ['custom', 'onCancel'],
      ['custom', 'onSave'],
    ]);
  });
});

describe('Phase 2: Block component kinds — retirement pins', () => {
  // The WHOLE block schema family is retired: `BlockSchema` (`type: 'block'`),
  // `BlockLibrarySchema` (`'block-library'`), `BlockEditorSchema`
  // (`'block-editor'`), `BlockInstanceSchema` (`'block-instance'`) and the
  // `ComponentSchema` (`'component'`) arm that rode the same union — objectui#4895,
  // ADR-0049 enforce-or-remove, under the maintainer ruling of 2026-09-02
  // (option C1, no transition window). Zero `ComponentRegistry.register(...)`
  // sites claimed any of the five; the positive control `'table'` resolves to
  // two, which is what makes that zero a reading rather than a broken grep.
  //
  // This is the pin that matters most on this retirement. The TypeScript half
  // was merely published; `blocks.zod.ts` shipped as RUNTIME values under
  // `@object-ui/types/zod`, and `AnyComponentSchema` accepted every one of the
  // five discriminants — so an author who copied the documented
  // `{ type: 'block-library' }` was told GREEN by the shipped validator and
  // then got the registry's "Unknown component type" panel (OBJUI-001).
  // Validated-then-broken is worse than never-validated. The shapes below are
  // the exact fixtures the old acceptance tests proved VALID; they are now
  // proven REFUSED, so a re-added kind fails here rather than reappearing
  // silently on the published surface.
  //
  // ⚠️ NOT this family, and deliberately not pinned out: the live slotted
  // record-page vocabulary (`PageNodeSchema.kind === 'slotted'` with
  // `slots?: PageSlotMap` in `../layout.ts`, rendered by `PageBlockCanvas` /
  // `PageBlockInspector` in `@object-ui/app-shell`), and the `type: 'component'`
  // NAVIGATION item kind declared by `NavigationItemSchema` in
  // `../zod/app.zod.ts` (objectui#2918) — a different declaration in a
  // different module, pinned live by `navigation-model.test.ts`.
  it('refuses the retired block component kinds, while a live kind still parses', () => {
    // The fixture the old `should validate a complete BlockSchema` case proved VALID.
    const retiredBlock = {
      type: 'block',
      meta: {
        name: 'hero-section',
        label: 'Hero Section',
        category: 'Marketing',
      },
      variables: [{ name: 'title', label: 'Title', type: 'string', defaultValue: 'Welcome', required: true }],
      slots: [{ name: 'content', label: 'Content', required: false }],
      template: { type: 'div', className: 'hero', children: [{ type: 'text', value: '${title}' }] },
      editable: true,
    };
    expect(AnyComponentSchema.safeParse(retiredBlock).success).toBe(false);

    // The fixture the old `should validate BlockLibrarySchema` case proved VALID —
    // and the exact shape the ruling names as the measured green light.
    const retiredLibrary = {
      type: 'block-library',
      category: 'Marketing',
      searchQuery: 'hero',
      showPremium: true,
      loading: false,
    };
    expect(AnyComponentSchema.safeParse(retiredLibrary).success).toBe(false);

    expect(AnyComponentSchema.safeParse({ type: 'block-editor', showVariables: true }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'block-instance', blockId: 'hero-section' }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'component', componentName: 'Hero' }).success).toBe(false);

    // Positive control on the same pipeline: a still-declared kind parses GREEN,
    // so the five refusals measure the retirement, not a broken union.
    expect(AnyComponentSchema.safeParse({ type: 'action', label: 'Control Action' }).success).toBe(true);
  });
});

describe('Phase 2: Enhanced ActionSchema Zod Validation', () => {
  it('should validate ajax action type', () => {
    const ajaxAction = {
      type: 'action',
      label: 'Load Data',
      actionType: 'ajax',
      api: '/api/data',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token',
      },
      // `onSuccess` / `onFailure` — Phase-2 `ActionCallback` objects — were RETIRED by
      // objectui#7068; this fixture was their only in-repo producer. Both faces refuse
      // them now, so this accept case authors the notices instead; the refusal and
      // its controls are pinned in `action-callback-retired-7068.test.ts`.
      successMessage: 'Data loaded successfully',
      errorMessage: 'Failed to load data',
    };

    const result = ActionSchema.safeParse(ajaxAction);
    expect(result.success).toBe(true);
  });

  it('should validate confirm action type', () => {
    const confirmAction = {
      type: 'action',
      label: 'Delete Record',
      actionType: 'confirm',
      confirmText: 'Are you sure you want to delete this record?',
      api: '/api/records/123',
      method: 'DELETE',
    };

    const result = ActionSchema.safeParse(confirmAction);
    expect(result.success).toBe(true);
  });

  it('refuses the retired structured confirm object (objectui#4314)', () => {
    const structured = {
      type: 'action',
      label: 'Delete Record',
      actionType: 'confirm',
      confirm: { title: 'Confirm Deletion', message: 'Are you sure?' },
    };

    // Zod half of the `crud.ts` `confirm?: never` tombstone: any authored
    // value is a LOUD parse rejection — never a silent strip, which would let
    // the author believe the dialog they configured exists. Absent stays
    // valid (accept case above).
    const result = ActionSchema.safeParse(structured);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('confirm');
    }
  });

  it('the confirm refusal CARRIES its remediation text (objectui#6931)', () => {
    // `confirm` ESTABLISHED this tombstone convention (objectui#4314) and was
    // the last key in the population still answering with zod's generic
    // `"Invalid input: expected never, received object"` — naming the key and
    // nothing else. The author now reads the remedy (`confirmText`) in the
    // message itself, which is what `packages/cli`'s `validate` / `check`
    // print verbatim beside the path and code.
    const result = ActionSchema.safeParse({
      type: 'action',
      label: 'Delete Record',
      actionType: 'confirm',
      confirm: { title: 'Confirm Deletion', message: 'Are you sure?' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.join('.') === 'confirm');
    expect(issue, 'parse failed, but not on the `confirm` path').toBeDefined();
    expect(issue!.message).not.toContain('Invalid input: expected never, received ');
    expect(issue!.message).toBe('RETIRED (objectui#4314) — author confirmText instead');
    // Accept set untouched: same code the bare `z.never()` reported — only the
    // message moved.
    expect(issue!.code).toBe('invalid_type');

    // Non-vacuity, IN THIS TEST: the canonical spelling still parses green.
    expect(
      ActionSchema.safeParse({ type: 'action', label: 'Delete Record', confirmText: 'Sure?' }).success,
    ).toBe(true);
  });

  it('carries the retirement to TypeScript authors (confirm is `never`)', () => {
    const action: CrudActionSchema = {
      type: 'action',
      label: 'Delete',
      // @ts-expect-error `confirm` is retired (objectui#4314) — its `message`
      // outranked `confirmText`, the only spelling the translation bundle
      // knows. `?: never` carries the retirement to authors writing
      // TypeScript; the Zod refusal above carries it to JSON.
      confirm: { message: 'Delete this item?' },
    };
    // The contract lives in the directive above: per this package's
    // `type-check` (tsc -p tsconfig.test.json compiles every test file),
    // putting the key back makes the directive unused and fails the build.
    expect(action.type).toBe('action');
  });

  it('should validate dialog action type', () => {
    const dialogAction = {
      type: 'action',
      label: 'Edit Details',
      actionType: 'dialog',
      dialog: {
        title: 'Edit Record',
        size: 'lg',
        content: {
          type: 'form',
          fields: [],
        },
      },
    };

    const result = ActionSchema.safeParse(dialogAction);
    expect(result.success).toBe(true);
  });

  it('should validate action chaining', () => {
    const chainedAction = {
      type: 'action',
      label: 'Process Order',
      actionType: 'ajax',
      api: '/api/orders/process',
      method: 'POST',
      chain: [
        {
          type: 'action',
          label: 'Send Email',
          actionType: 'ajax',
          api: '/api/emails/send',
          method: 'POST',
        },
        {
          type: 'action',
          label: 'Update Inventory',
          actionType: 'ajax',
          api: '/api/inventory/update',
          method: 'PUT',
        },
      ],
      chainMode: 'sequential',
    };

    const result = ActionSchema.safeParse(chainedAction);
    expect(result.success).toBe(true);
  });

  // `condition` is an execution GATE, not a branch DSL (objectui#3917). Each
  // arm below is one the runtime honours — `ActionRunner.execute` asks
  // `hasDeclaredPredicate(action.condition)` and then `evaluateCondition`, both
  // of which read exactly boolean / bare CEL / `${…}` template / the
  // `{ dialect, source }` envelope `objectstack build` emits. Before the
  // retirement `condition` required an `expression` key, so EVERY spelling in
  // this table was refused by the schema while being honoured at runtime.
  it.each([
    ['a boolean', false],
    ['a bare CEL predicate', 'data.amount > 1000'],
    ['a ${…} template', '${data.amount > 1000}'],
    ['the normalized envelope', { dialect: 'cel', source: 'data.amount > 1000' }],
  ])('should accept a condition gate written as %s', (_label, condition) => {
    const gatedAction = {
      type: 'action',
      label: 'Approve',
      actionType: 'button',
      condition,
    };

    const result = ActionSchema.safeParse(gatedAction);
    expect(result.success).toBe(true);
  });

  // The retirement itself (objectui#3917). This is the shape two docs pages
  // taught with worked examples while NOTHING read `expression` / `then` /
  // `else`: the object carries no `source`, so the runtime's normalizer read it
  // as "no gate declared" and ran the action unconditionally — the predicate
  // never evaluated, the branches never dispatched, zero diagnostics. Asserting
  // the FULL parse is red (not merely that some issue exists) is the point: the
  // verdict on this authoring surface has to be a refusal, and it has to be
  // pinned to the `condition` key, or the next widening restores the silent
  // accept without any test noticing.
  it('should refuse the retired { expression, then, else } branch shape', () => {
    const branchAction = {
      type: 'action',
      label: 'Approve',
      actionType: 'button',
      condition: {
        expression: '${data.amount > 1000}',
        then: {
          type: 'action',
          label: 'Require Manager Approval',
          actionType: 'confirm',
        },
        else: {
          type: 'action',
          label: 'Auto Approve',
          actionType: 'ajax',
        },
      },
    };

    const result = ActionSchema.safeParse(branchAction);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues.filter((i) => i.path[0] === 'condition');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].code).toBe('invalid_union');
  });

  it('should validate action with tracking', () => {
    const trackedAction = {
      type: 'action',
      label: 'Download Report',
      actionType: 'ajax',
      api: '/api/reports/download',
      tracking: {
        enabled: true,
        event: 'report_downloaded',
        metadata: {
          reportType: 'sales',
          format: 'pdf',
        },
      },
    };

    const result = ActionSchema.safeParse(trackedAction);
    expect(result.success).toBe(true);
  });

  it('should validate action with retry configuration', () => {
    const retryAction = {
      type: 'action',
      label: 'Submit',
      actionType: 'ajax',
      api: '/api/submit',
      timeout: 30000,
      retry: {
        maxAttempts: 3,
        delay: 1000,
      },
    };

    const result = ActionSchema.safeParse(retryAction);
    expect(result.success).toBe(true);
  });
});

describe('Phase 2: View Schemas Zod Validation', () => {
  it('should validate DetailViewSchema', () => {
    const detailView = {
      type: 'detail-view',
      title: 'Customer Details',
      api: '/api/customers/123',
      layout: 'grid',
      columns: 2,
      sections: [
        {
          title: 'Basic Information',
          fields: [
            {
              name: 'name',
              label: 'Name',
              type: 'text',
            },
            {
              name: 'email',
              label: 'Email',
              type: 'text',
            },
          ],
        },
      ],
      tabs: [
        {
          key: 'orders',
          label: 'Orders',
          content: {
            type: 'table',
            columns: [],
            // `data` is a REQUIRED member of `TableSchema`. Until objectui#8344 this
            // node sat in a child slot judged by the base shape, so the omission was
            // invisible; the recursion point resolves per-type now and it is not.
            data: [],
          },
        },
      ],
      showBack: true,
      showEdit: true,
      showDelete: false,
    };

    const result = DetailViewSchema.safeParse(detailView);
    expect(result.success).toBe(true);
  });

  it('should validate ViewSwitcherSchema', () => {
    const viewSwitcher = {
      type: 'view-switcher',
      views: [
        {
          type: 'list',
          label: 'List View',
          icon: 'List',
        },
        {
          type: 'grid',
          label: 'Grid View',
          icon: 'Grid',
        },
        {
          type: 'kanban',
          label: 'Kanban',
          icon: 'Kanban',
        },
      ],
      defaultView: 'list',
      variant: 'tabs',
      position: 'top',
      persistPreference: true,
      storageKey: 'view-preference',
    };

    const result = ViewSwitcherSchema.safeParse(viewSwitcher);
    expect(result.success).toBe(true);
  });

  it('should validate FilterUISchema', () => {
    const filterUI = {
      type: 'filter-ui',
      filters: [
        {
          field: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
        },
        {
          field: 'created_at',
          label: 'Created Date',
          type: 'date-range',
        },
      ],
      showClear: true,
      showApply: true,
      layout: 'popover',
    };

    const result = FilterUISchema.safeParse(filterUI);
    expect(result.success).toBe(true);
  });

  it('should validate SortUISchema', () => {
    const sortUI = {
      type: 'sort-ui',
      fields: [
        {
          field: 'name',
          label: 'Name',
        },
        {
          field: 'created_at',
          label: 'Created Date',
        },
      ],
      sort: [
        {
          field: 'created_at',
          direction: 'desc',
        },
      ],
      multiple: false,
      variant: 'dropdown',
    };

    const result = SortUISchema.safeParse(sortUI);
    expect(result.success).toBe(true);
  });
});

describe('Phase 2: AnyComponentSchema Union Type', () => {
  it('should validate any Phase 2 schema through union type', () => {
    const schemas = [
      { type: 'app', name: 'test-app' },
      // `{ type: 'theme' }` removed with the kind itself (objectui#5489); its
      // refusal is pinned in the theme describe block above.
      { type: 'report', title: 'Test Report' },
      // `{ type: 'block' }` removed with the whole family (objectui#4895); the
      // refusals are pinned in the block describe block above.
      { type: 'action', label: 'Test Action' },
      { type: 'detail-view', title: 'Test Detail' },
      { type: 'view-switcher', views: [] },
    ];

    schemas.forEach((schema) => {
      const result = AnyComponentSchema.safeParse(schema);
      expect(result.success).toBe(true);
    });
  });
});

describe('ListViewSchema userFilters Zod Validation', () => {
  it('should validate dropdown mode userFilters', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: {
        element: 'dropdown',
        fields: [
          {
            field: 'status',
            label: 'Status',
            type: 'multi-select',
            showCount: true,
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Inactive', value: 'inactive', color: '#dc2626' },
            ],
            defaultValues: ['active'],
          },
        ],
      },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(true);
  });

  it('should validate tabs mode userFilters', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: {
        element: 'tabs',
        showAllRecords: true,
        allowAddTab: true,
        tabs: [
          { id: 'tab-1', label: 'Active', filters: [['status', '=', 'active']], default: true },
          { id: 'tab-2', label: 'My Items', filters: [['owner', '=', '$currentUser']] },
        ],
      },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(true);
  });

  it('should validate canonical tabs ({ name, label, filter:[{field,operator,value}] })', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: {
        element: 'tabs',
        showAllRecords: true,
        tabs: [
          { name: 'active', label: 'Active', filter: [{ field: 'status', operator: 'equals', value: 'active' }], isDefault: true },
          { name: 'mine', label: 'My Items', filter: [{ field: 'owner', operator: 'equals', value: '$currentUser' }] },
        ],
      },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(true);
  });

  it('should reject a tab missing both name and id', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: { element: 'tabs', tabs: [{ label: 'No identifier', filter: [] }] },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(false);
  });

  it('should reject the deprecated toggle element (ADR-0053 — only dropdown | tabs)', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: {
        element: 'toggle',
        fields: [
          { field: 'is_active', label: 'Active Only' },
          { field: 'is_vip', label: 'VIP', defaultValues: [true] },
        ],
      },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(false);
  });

  it('should reject invalid element type', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      userFilters: {
        element: 'invalid',
      },
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(false);
  });

  it('should validate ListViewSchema without userFilters (backward compat)', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      fields: ['name', 'email'],
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(true);
  });

  // `striped` / `bordered` were part of this fixture until objectui#4649.
  // They are not objectui's keys to assert: `ListViewSchema` takes them from
  // the spec by reference, so this case was really pinning the SPEC pin's
  // vocabulary — and objectstack#7176 retired all three. Left in, the fixture
  // would flip red the moment the pin moves to GA, where the keys are
  // `retiredKey()` tombstones that reject. Trimmed to the keys objectui does
  // own, the case still covers what it was written for (the local `show*` /
  // `color` extends); the retirement itself is pinned in
  // `p1-spec-alignment.test.ts` on objectui's own types.
  it('should validate ListViewSchema with showSearch/showSort/showFilters/color', () => {
    const schema = {
      type: 'list-view',
      objectName: 'accounts',
      fields: ['name', 'email'],
      showSearch: true,
      showSort: false,
      showFilters: true,
      color: 'status',
    };
    const result = ListViewSchema.safeParse(schema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.showSearch).toBe(true);
      expect(result.data.showSort).toBe(false);
      expect(result.data.showFilters).toBe(true);
      expect(result.data.color).toBe('status');
    }
  });
});
