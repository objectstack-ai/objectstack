import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ViewSchema,
  ListViewSchema,
  FormViewSchema,
  FormSectionSchema,
  KanbanConfigSchema,
  CalendarConfigSchema,
  GanttConfigSchema,
  ListColumnSchema,
  FormFieldSchema,
  SelectionConfigSchema,
  PaginationConfigSchema,
  ViewDataSchema,
  HttpRequestSchema,
  HttpMethodSubsetSchema,
  ColumnSummarySchema,
  RowHeightSchema,
  GroupingConfigSchema,
  GroupingFieldSchema,
  GalleryConfigSchema,
  TimelineConfigSchema,
  ViewSharingSchema,
  RowColorConfigSchema,
  VisualizationTypeSchema,
  UserActionsConfigSchema,
  AppearanceConfigSchema,
  ViewTabSchema,
  UserFiltersSchema,
  ViewFilterRuleSchema,
  AddRecordConfigSchema,
  type View,
  type ListView,
  type FormView,
  type ListColumn,
  type FormField,
  type ViewData,
  type HttpRequest,
  defineView,
  defineForm,
  ViewItemSchema,
  ViewMetadataSchema,
} from './view.zod';

import {
  exportNamesOf,
  maybeOriginOf,
  originFileOf,
  originOf,
} from '../../scripts/lib/export-origins-testkit';
describe('HttpMethodSubsetSchema', () => {
  it('should accept valid HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
    
    methods.forEach(method => {
      expect(() => HttpMethodSubsetSchema.parse(method)).not.toThrow();
    });
  });

  it('should reject invalid HTTP methods', () => {
    expect(() => HttpMethodSubsetSchema.parse('INVALID')).toThrow();
  });
});

describe('HttpRequestSchema', () => {
  it('should accept minimal HTTP request config', () => {
    const request: HttpRequest = {
      url: '/api/data',
    };

    const result = HttpRequestSchema.parse(request);
    expect(result.method).toBe('GET');
  });

  it('should accept full HTTP request config', () => {
    const request: HttpRequest = {
      url: '/api/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      params: { filter: 'active' },
      body: { name: 'test' },
    };

    expect(() => HttpRequestSchema.parse(request)).not.toThrow();
  });
});

describe('ViewDataSchema', () => {
  it('should accept object provider with object name', () => {
    const data: ViewData = {
      provider: 'object',
      object: 'account',
    };

    expect(() => ViewDataSchema.parse(data)).not.toThrow();
  });

  it('should require object name for object provider', () => {
    const data = {
      provider: 'object',
    };

    expect(() => ViewDataSchema.parse(data)).toThrow();
  });

  it('should accept api provider with read configuration', () => {
    const data: ViewData = {
      provider: 'api',
      read: {
        url: '/api/accounts',
        method: 'GET',
        params: { status: 'active' },
      },
    };

    expect(() => ViewDataSchema.parse(data)).not.toThrow();
  });

  it('should accept api provider with read and write configurations', () => {
    const data: ViewData = {
      provider: 'api',
      read: {
        url: '/api/accounts',
        method: 'GET',
      },
      write: {
        url: '/api/accounts',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    };

    expect(() => ViewDataSchema.parse(data)).not.toThrow();
  });

  it('should accept value provider with static items', () => {
    const data: ViewData = {
      provider: 'value',
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
    };

    expect(() => ViewDataSchema.parse(data)).not.toThrow();
  });

  it('should require items for value provider', () => {
    const data = {
      provider: 'value',
    };

    expect(() => ViewDataSchema.parse(data)).toThrow();
  });
});

describe('KanbanConfigSchema', () => {
  it('should accept minimal kanban config', () => {
    const config = {
      groupByField: 'status',
      columns: ['name', 'owner'],
    };

    expect(() => KanbanConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept kanban config with summarize field', () => {
    const config = {
      groupByField: 'stage',
      summarizeField: 'amount',
      columns: ['name', 'amount', 'close_date'],
    };

    expect(() => KanbanConfigSchema.parse(config)).not.toThrow();
  });
});

describe('CalendarConfigSchema', () => {
  it('should accept minimal calendar config', () => {
    const config = {
      startDateField: 'start_date',
      titleField: 'subject',
    };

    expect(() => CalendarConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept full calendar config', () => {
    const config = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'subject',
      colorField: 'priority',
    };

    expect(() => CalendarConfigSchema.parse(config)).not.toThrow();
  });
});

describe('GanttConfigSchema', () => {
  it('should accept minimal gantt config', () => {
    const config = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name',
    };

    expect(() => GanttConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept full gantt config', () => {
    const config = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'project_name',
      progressField: 'completion_percent',
      dependenciesField: 'depends_on',
    };

    expect(() => GanttConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept extended renderer fields (hierarchy, baseline, grouping, resource, tooltip, quick filters)', () => {
    const config = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name',
      colorField: 'status',
      parentField: 'parent_id',
      typeField: 'row_type',
      baselineStartField: 'planned_start',
      baselineEndField: 'planned_end',
      groupByField: 'workshop',
      resourceView: true,
      assigneeField: 'owner',
      effortField: 'effort',
      capacity: 8,
      tooltipFields: ['owner', { field: 'effort', label: '工时' }],
      quickFilters: [
        { field: 'status' },
        { field: 'category', label: '类别', options: ['A', { value: 1, label: 'B' }] },
      ],
      autoZoomToFilter: false,
    };

    expect(() => GanttConfigSchema.parse(config)).not.toThrow();
    expect(GanttConfigSchema.parse(config)).toMatchObject({ parentField: 'parent_id', typeField: 'row_type' });
  });

  it('should passthrough unknown renderer fields ahead of this schema', () => {
    const config = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name',
      // Newer renderer knobs not yet declared here (e.g. objectui plugin-gantt).
      lockField: 'is_locked',
      defaultCollapsedDepth: 2,
    };

    expect(() => GanttConfigSchema.parse(config)).not.toThrow();
    expect(GanttConfigSchema.parse(config)).toMatchObject({ lockField: 'is_locked', defaultCollapsedDepth: 2 });
  });
});

describe('ListViewSchema', () => {
  it('should accept minimal grid view', () => {
    const listView: ListView = {
      columns: ['name', 'email', 'phone'],
    };

    const result = ListViewSchema.parse(listView);
    expect(result.type).toBe('grid');
  });

  it('should accept all list view types', () => {
    const types = ['grid', 'kanban', 'calendar', 'gantt', 'map'] as const;
    
    types.forEach(type => {
      const view: ListView = {
        type,
        columns: ['name'],
      };
      expect(() => ListViewSchema.parse(view)).not.toThrow();
    });
  });

  it('should accept list view with filter and sort', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'status', 'created_at'],
      filter: [
        { field: 'status', operator: 'equals', value: 'active' },
      ],
      sort: [
        { field: 'created_at', order: 'desc' },
        { field: 'name', order: 'asc' },
      ],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept legacy string sort format', () => {
    const listView: ListView = {
      columns: ['name'],
      sort: 'created_at desc',
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with searchable fields', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'email', 'phone'],
      searchableFields: ['name', 'email', 'phone'],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with top filter fields', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'status'],
      filterableFields: ['status', 'category', 'owner'],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept kanban view with config', () => {
    const kanbanView: ListView = {
      type: 'kanban',
      columns: ['name', 'owner', 'amount'],
      kanban: {
        groupByField: 'stage',
        summarizeField: 'amount',
        columns: ['name', 'owner', 'close_date'],
      },
    };

    expect(() => ListViewSchema.parse(kanbanView)).not.toThrow();
  });

  it('should accept calendar view with config', () => {
    const calendarView: ListView = {
      type: 'calendar',
      columns: ['subject', 'start_date', 'end_date'],
      calendar: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'subject',
        colorField: 'priority',
      },
    };

    expect(() => ListViewSchema.parse(calendarView)).not.toThrow();
  });

  it('should accept gantt view with config', () => {
    const ganttView: ListView = {
      type: 'gantt',
      columns: ['name', 'start_date', 'end_date', 'progress'],
      gantt: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'name',
        progressField: 'progress',
        dependenciesField: 'depends_on',
      },
    };

    expect(() => ListViewSchema.parse(ganttView)).not.toThrow();
  });

  it('should accept named list view', () => {
    const namedView: ListView = {
      name: 'active_accounts',
      label: 'Active Accounts',
      type: 'grid',
      columns: ['account_name', 'industry', 'annual_revenue'],
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
    };

    expect(() => ListViewSchema.parse(namedView)).not.toThrow();
  });

  it('should accept list view with object provider', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'email'],
      data: {
        provider: 'object',
        object: 'contact',
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with api provider', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'email', 'phone'],
      data: {
        provider: 'api',
        read: {
          url: '/api/contacts',
          method: 'GET',
        },
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with value provider', () => {
    const listView: ListView = {
      type: 'grid',
      columns: ['name', 'status'],
      data: {
        provider: 'value',
        items: [
          { name: 'Task 1', status: 'Open' },
          { name: 'Task 2', status: 'Closed' },
        ],
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept kanban view with custom api data source', () => {
    const kanbanView: ListView = {
      type: 'kanban',
      columns: ['name', 'owner', 'amount'],
      data: {
        provider: 'api',
        read: {
          url: '/api/opportunities',
          params: { view: 'pipeline' },
        },
      },
      kanban: {
        groupByField: 'stage',
        summarizeField: 'amount',
        columns: ['name', 'owner', 'close_date'],
      },
    };

    expect(() => ListViewSchema.parse(kanbanView)).not.toThrow();
  });
});

describe('FormSectionSchema', () => {
  it('should accept minimal form section', () => {
    const section = {
      fields: ['name', 'email'],
    };

    const result = FormSectionSchema.parse(section);
    expect(result.collapsible).toBe(false);
    expect(result.collapsed).toBe(false);
    expect(result.columns).toBe(1);
  });

  it('should accept form section with all properties', () => {
    const section = {
      label: 'Contact Information',
      collapsible: true,
      collapsed: false,
      columns: '3' as const,
      fields: ['first_name', 'last_name', 'email', 'phone'],
    };

    const result = FormSectionSchema.parse(section);
    expect(result.columns).toBe(3);
  });

  it('should transform column strings to numbers', () => {
    const columnOptions = ['1', '2', '3', '4'] as const;
    
    columnOptions.forEach(cols => {
      const section = {
        columns: cols,
        fields: ['field1'],
      };
      const result = FormSectionSchema.parse(section);
      expect(result.columns).toBe(parseInt(cols));
    });
  });
});

describe('FormViewSchema', () => {
  it('should accept minimal form view', () => {
    const formView: FormView = {};

    const result = FormViewSchema.parse(formView);
    expect(result.type).toBe('simple');
  });

  it('should accept all form view types', () => {
    const types = ['simple', 'tabbed', 'wizard'] as const;
    
    types.forEach(type => {
      const view: FormView = { type };
      expect(() => FormViewSchema.parse(view)).not.toThrow();
    });
  });

  it('should accept form view with sections', () => {
    const formView: FormView = {
      type: 'simple',
      sections: [
        {
          label: 'Basic Information',
          fields: ['name', 'email', 'phone'],
        },
        {
          label: 'Address',
          collapsible: true,
          fields: ['street', 'city', 'state', 'zip'],
        },
      ],
    };

    expect(() => FormViewSchema.parse(formView)).not.toThrow();
  });

  it('should accept form view with groups (legacy)', () => {
    const formView: FormView = {
      type: 'simple',
      groups: [
        {
          label: 'Account Details',
          fields: ['account_name', 'account_number'],
        },
      ],
    };

    expect(() => FormViewSchema.parse(formView)).not.toThrow();
    // #6926 — acceptance is unchanged; the OUTPUT is what changed. This pin
    // asserted acceptance only, which is exactly why it stayed green through
    // the whole life of the unfolded alias. Say what the parse now produces.
    const parsed = FormViewSchema.parse(formView) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, 'groups')).toBe(false);
    expect((parsed.sections as Array<{ label?: string }>)[0]?.label).toBe('Account Details');
  });

  it('should accept tabbed form view', () => {
    const tabbedView: FormView = {
      type: 'tabbed',
      sections: [
        {
          label: 'Details',
          fields: ['name', 'description'],
        },
        {
          label: 'Advanced',
          fields: ['settings', 'metadata'],
        },
      ],
    };

    expect(() => FormViewSchema.parse(tabbedView)).not.toThrow();
  });

  it('should accept wizard form view', () => {
    const wizardView: FormView = {
      type: 'wizard',
      sections: [
        {
          label: 'Step 1: Basic Info',
          fields: ['name', 'email'],
        },
        {
          label: 'Step 2: Preferences',
          fields: ['language', 'timezone'],
        },
        {
          label: 'Step 3: Review',
          fields: [],
        },
      ],
    };

    expect(() => FormViewSchema.parse(wizardView)).not.toThrow();
  });

  // form `data` SURVIVED the #3896 sweep: the removal attempt broke the build
  // — defineForm writes data.provider='schema' onto every metadata form — so
  // the ledger verdict was corrected instead. These pin the surviving shapes.
  it('accepts form view with object provider', () => {
    expect(() => FormViewSchema.parse({
      type: 'simple',
      data: { provider: 'object', object: 'account' },
      sections: [{ fields: ['name'] }],
    })).not.toThrow();
  });
  it('accepts the schema provider defineForm writes', () => {
    expect(() => FormViewSchema.parse({
      type: 'simple',
      data: { provider: 'schema', schemaId: 'flow' },
      sections: [{ fields: ['name'] }],
    })).not.toThrow();
  });

  // `section.pane` — explicit split placement. Explicit-per-section so the
  // assignment is visible in the metadata and survives reordering (the legacy
  // rule was positional: first section left, rest right — invisible, and a
  // reorder silently moved sections across the divider).
  describe('section.pane (split placement)', () => {
    it('accepts pane assignments on a split form', () => {
      const result = FormViewSchema.parse({
        type: 'split',
        sections: [
          { label: 'Task', pane: 'primary', fields: ['title'] },
          { label: 'Schedule', pane: 'secondary', fields: ['due_date'] },
          // Omitted pane is fine — the renderer defaults by position.
          { label: 'Notes', fields: ['notes'] },
        ],
      });
      expect(result.sections?.map((s) => s.pane)).toEqual(['primary', 'secondary', undefined]);
    });

    it('rejects a typo pane value (strict enum, not free text)', () => {
      expect(() => FormViewSchema.parse({
        type: 'split',
        sections: [{ label: 'Task', pane: 'left', fields: ['title'] }],
      })).toThrow();
    });

    it('rejects pane on a non-split form instead of silently ignoring it', () => {
      // "Accepted but ignored" is the failure mode this key must never have —
      // especially for AI-authored metadata, where a no-op reads as working.
      const result = FormViewSchema.safeParse({
        type: 'tabbed',
        sections: [
          { label: 'Details', fields: ['name'] },
          { label: 'Advanced', pane: 'secondary', fields: ['settings'] },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'sections.1.pane');
        expect(issue?.message).toMatch(/only valid on `type: 'split'`/);
      }
    });

    it('rejects pane on the legacy `groups` alias the same way', () => {
      const result = FormViewSchema.safeParse({
        type: 'simple',
        groups: [{ label: 'Account', pane: 'primary', fields: ['account_name'] }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join('.') === 'groups.0.pane')).toBe(true);
      }
    });

    it('defaulted `type` counts as non-split (a forgotten type errors loudly)', () => {
      expect(FormViewSchema.safeParse({
        sections: [{ label: 'Task', pane: 'primary', fields: ['title'] }],
      }).success).toBe(false);
    });
  });
});

/**
 * #6926 — `groups` is declared as an alias of `sections` and, until this
 * change, nothing folded it: the alias was honored one boundary downstream in
 * objectui's renderer, so the same authored form rendered in the console and
 * degraded on the framework's REST public-form routes (which read `sections`
 * only). The fold now happens at the PRODUCER.
 *
 * These cases discriminate the fold — the two pre-existing `groups` pins
 * (acceptance, and the `pane` error path) cannot, which is the measured reason
 * an unfolded alias survived this file for its whole life.
 */
describe('FormViewSchema — the `groups` legacy alias folds onto `sections` (#6926)', () => {
  const S = (label: string) => ({ label, fields: [label.toLowerCase()] });
  const has = (o: unknown, k: string) => Object.prototype.hasOwnProperty.call(o as object, k);

  it('groups-only → sections, with `groups` absent from the output', () => {
    const parsed = FormViewSchema.parse({ type: 'simple', groups: [S('Account')] });
    expect(has(parsed, 'groups')).toBe(false);
    expect(parsed.sections?.map((s) => s.label)).toEqual(['Account']);
  });

  it('both present → `sections` wins (the renderer\'s own `sections ?? groups` rule)', () => {
    const parsed = FormViewSchema.parse({
      type: 'simple',
      sections: [S('Canonical')],
      groups: [S('Legacy')],
    });
    expect(has(parsed, 'groups')).toBe(false);
    expect(parsed.sections?.map((s) => s.label)).toEqual(['Canonical']);
  });

  it('an EMPTY `sections` still wins over a populated `groups` (`??`, not a merge)', () => {
    const parsed = FormViewSchema.parse({ type: 'simple', sections: [], groups: [S('Legacy')] });
    expect(has(parsed, 'groups')).toBe(false);
    expect(parsed.sections).toEqual([]);
  });

  it('an empty `groups` folds to an empty `sections` (content, not absence)', () => {
    const parsed = FormViewSchema.parse({ type: 'simple', groups: [] });
    expect(has(parsed, 'groups')).toBe(false);
    expect(parsed.sections).toEqual([]);
  });

  it('sections-only and neither-key forms are untouched', () => {
    expect(FormViewSchema.parse({ type: 'simple', sections: [S('Only')] }).sections?.[0]?.label)
      .toBe('Only');
    const bare = FormViewSchema.parse({ type: 'simple' });
    expect(has(bare, 'sections')).toBe(false);
    expect(has(bare, 'groups')).toBe(false);
  });

  it('the ACCEPTANCE face is unchanged — `groups` stays legal at input', () => {
    expect(FormViewSchema.safeParse({ type: 'simple', groups: [S('Account')] }).success).toBe(true);
    // …and the fold does not launder an invalid section past the schema.
    expect(FormViewSchema.safeParse({ type: 'simple', groups: [{ label: 'No fields' }] }).success)
      .toBe(false);
  });

  it('the `pane` refinement still reports the key the AUTHOR wrote', () => {
    const result = FormViewSchema.safeParse({
      type: 'simple',
      groups: [{ label: 'Account', pane: 'primary', fields: ['account_name'] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'groups.0.pane')).toBe(true);
    }
  });

  describe('every parse door inherits the fold (one declaration, not per-door)', () => {
    it('ViewSchema.form', () => {
      const parsed = ViewSchema.parse({ form: { type: 'simple', groups: [S('Account')] } });
      expect(has(parsed.form, 'groups')).toBe(false);
      expect(parsed.form?.sections?.map((s) => s.label)).toEqual(['Account']);
    });

    it('ViewSchema.formViews.*', () => {
      const parsed = ViewSchema.parse({ formViews: { edit: { type: 'simple', groups: [S('Account')] } } });
      expect(has(parsed.formViews?.edit, 'groups')).toBe(false);
      expect(parsed.formViews?.edit?.sections?.map((s) => s.label)).toEqual(['Account']);
    });

    it('defineView (the authored container door)', () => {
      const view = defineView({ form: { type: 'simple', groups: [S('Account')] } });
      expect(has(view.form, 'groups')).toBe(false);
      expect(view.form?.sections?.map((s) => s.label)).toEqual(['Account']);
    });

    it('defineForm (the metadata-admin form door)', () => {
      const form = defineForm({ schemaId: 'report', type: 'simple', groups: [S('Account')] });
      expect(has(form, 'groups')).toBe(false);
      expect(form.sections?.map((s) => s.label)).toEqual(['Account']);
    });

    it('ViewItemSchema — the standalone `form` record arm', () => {
      const parsed = ViewItemSchema.parse({
        name: 'crm_account.edit',
        object: 'account',
        viewKind: 'form',
        config: { type: 'simple', groups: [S('Account')] },
      });
      const config = (parsed as { config: Record<string, unknown> }).config;
      expect(has(config, 'groups')).toBe(false);
      expect((config.sections as Array<{ label?: string }>).map((s) => s.label)).toEqual(['Account']);
    });

    it('ViewMetadataSchema — the container member', () => {
      const parsed = ViewMetadataSchema.parse({ form: { type: 'simple', groups: [S('Account')] } }) as {
        form?: Record<string, unknown>;
      };
      expect(has(parsed.form, 'groups')).toBe(false);
      expect((parsed.form?.sections as Array<{ label?: string }>).map((s) => s.label)).toEqual(['Account']);
    });

    it('ViewMetadataSchema — the FLATTENED form-overlay member (`.extend()` inherits the fold)', () => {
      const parsed = ViewMetadataSchema.parse({
        viewKind: 'form',
        type: 'simple',
        groups: [S('Account')],
      }) as Record<string, unknown>;
      expect(has(parsed, 'groups')).toBe(false);
      expect((parsed.sections as Array<{ label?: string }>).map((s) => s.label)).toEqual(['Account']);
    });
  });
});

describe('ViewSchema', () => {
  it('should accept minimal view schema', () => {
    const view: View = {};

    expect(() => ViewSchema.parse(view)).not.toThrow();
  });

  it('should accept view with default list and form', () => {
    const view: View = {
      list: {
        columns: ['name', 'status'],
      },
      form: {
        sections: [
          { fields: ['name', 'status'] },
        ],
      },
    };

    expect(() => ViewSchema.parse(view)).not.toThrow();
  });

  it('should accept view with named list views', () => {
    const view: View = {
      list: {
        columns: ['name'],
      },
      listViews: {
        all: {
          label: 'All Records',
          columns: ['name', 'created_at'],
        },
        active: {
          label: 'Active Only',
          columns: ['name', 'status'],
          filter: [{ field: 'status', operator: 'equals', value: 'active' }],
        },
        my_records: {
          label: 'My Records',
          columns: ['name', 'owner'],
          filter: [{ field: 'owner_id', operator: 'equals', value: '$USER_ID' }],
        },
      },
    };

    expect(() => ViewSchema.parse(view)).not.toThrow();
  });

  it('should accept view with named form views', () => {
    const view: View = {
      form: {
        type: 'simple',
        sections: [{ fields: ['name'] }],
      },
      formViews: {
        detailed: {
          type: 'tabbed',
          sections: [
            { label: 'Basic', fields: ['name', 'email'] },
            { label: 'Advanced', fields: ['settings'] },
          ],
        },
        quick_create: {
          type: 'simple',
          sections: [{ fields: ['name'] }],
        },
      },
    };

    expect(() => ViewSchema.parse(view)).not.toThrow();
  });

  describe('Real-World View Examples', () => {
    it('should accept CRM opportunity views', () => {
      const opportunityViews: View = {
        list: {
          type: 'grid',
          columns: ['name', 'account_name', 'amount', 'stage', 'close_date'],
          sort: [
            { field: 'close_date', order: 'asc' },
          ],
        },
        listViews: {
          pipeline: {
            name: 'pipeline',
            label: 'Sales Pipeline',
            type: 'kanban',
            columns: ['name', 'account_name', 'amount', 'close_date'],
            kanban: {
              groupByField: 'stage',
              summarizeField: 'amount',
              columns: ['name', 'account_name', 'amount'],
            },
          },
          closing_this_quarter: {
            name: 'closing_this_quarter',
            label: 'Closing This Quarter',
            type: 'grid',
            columns: ['name', 'account_name', 'amount', 'stage', 'close_date'],
            filter: [
              { field: 'close_date', operator: 'after', value: '2024-01-01' },
            ],
            sort: [{ field: 'amount', order: 'desc' }],
          },
        },
        form: {
          type: 'tabbed',
          sections: [
            {
              label: 'Opportunity Details',
              columns: '2',
              fields: ['name', 'account_id', 'amount', 'stage', 'close_date', 'probability'],
            },
            {
              label: 'Contact Information',
              columns: '2',
              fields: ['primary_contact', 'email', 'phone'],
            },
            {
              label: 'Additional Information',
              collapsible: true,
              collapsed: true,
              columns: '2',
              fields: ['description', 'next_step', 'lead_source'],
            },
          ],
        },
      };

      expect(() => ViewSchema.parse(opportunityViews)).not.toThrow();
    });

    it('should accept project task views with calendar and gantt', () => {
      const taskViews: View = {
        list: {
          columns: ['subject', 'status', 'priority', 'assigned_to', 'due_date'],
        },
        listViews: {
          calendar: {
            type: 'calendar',
            columns: ['subject', 'due_date'],
            calendar: {
              startDateField: 'due_date',
              titleField: 'subject',
              colorField: 'priority',
            },
          },
          timeline: {
            type: 'gantt',
            columns: ['subject', 'start_date', 'due_date', 'progress'],
            gantt: {
              startDateField: 'start_date',
              endDateField: 'due_date',
              titleField: 'subject',
              progressField: 'progress',
              dependenciesField: 'dependencies',
            },
          },
        },
        form: {
          type: 'simple',
          sections: [
            {
              label: 'Task Information',
              fields: ['subject', 'environment_id', 'status', 'priority'],
            },
            {
              label: 'Schedule',
              columns: '2',
              fields: ['start_date', 'due_date', 'estimated_hours'],
            },
            {
              label: 'Assignment',
              fields: ['assigned_to', 'team'],
            },
          ],
        },
      };

      expect(() => ViewSchema.parse(taskViews)).not.toThrow();
    });
  });
});

describe('ListColumnSchema', () => {
  it('should accept minimal column config', () => {
    const column: ListColumn = {
      field: 'account_name',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept full column config', () => {
    const column: ListColumn = {
      field: 'annual_revenue',
      label: 'Annual Revenue',
      width: 150,
      align: 'right',
      hidden: false,
      sortable: true,
      resizable: true,
      wrap: false,
      type: 'currency',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept column with alignment options', () => {
    const alignments = ['left', 'center', 'right'] as const;
    
    alignments.forEach(align => {
      const column: ListColumn = {
        field: 'test_field',
        align,
      };
      expect(() => ListColumnSchema.parse(column)).not.toThrow();
    });
  });

  it('should reject negative width', () => {
    const column = {
      field: 'test_field',
      width: -100,
    };

    expect(() => ListColumnSchema.parse(column)).toThrow();
  });

  it('should reject zero width', () => {
    const column = {
      field: 'test_field',
      width: 0,
    };

    expect(() => ListColumnSchema.parse(column)).toThrow();
  });
});

describe('SelectionConfigSchema', () => {
  it('should default to none', () => {
    const selection = {};

    const result = SelectionConfigSchema.parse(selection);
    expect(result.type).toBe('none');
  });

  it('should accept all selection types', () => {
    const types = ['none', 'single', 'multiple'] as const;
    
    types.forEach(type => {
      const selection = { type };
      expect(() => SelectionConfigSchema.parse(selection)).not.toThrow();
    });
  });
});

describe('PaginationConfigSchema', () => {
  it('should default pageSize to 25', () => {
    const pagination = {};

    const result = PaginationConfigSchema.parse(pagination);
    expect(result.pageSize).toBe(25);
  });

  it('should accept custom page size', () => {
    const pagination = {
      pageSize: 50,
    };

    const result = PaginationConfigSchema.parse(pagination);
    expect(result.pageSize).toBe(50);
  });

  it('should accept page size options', () => {
    const pagination = {
      pageSize: 25,
      pageSizeOptions: [10, 25, 50, 100],
    };

    expect(() => PaginationConfigSchema.parse(pagination)).not.toThrow();
  });

  it('should reject negative pageSize', () => {
    const pagination = {
      pageSize: -10,
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });

  it('should reject zero pageSize', () => {
    const pagination = {
      pageSize: 0,
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });

  it('should reject non-integer pageSize', () => {
    const pagination = {
      pageSize: 25.5,
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });

  it('should reject negative values in pageSizeOptions', () => {
    const pagination = {
      pageSize: 25,
      pageSizeOptions: [10, -25, 50],
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });

  it('should reject zero values in pageSizeOptions', () => {
    const pagination = {
      pageSize: 25,
      pageSizeOptions: [10, 0, 50],
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });

  it('should reject non-integer values in pageSizeOptions', () => {
    const pagination = {
      pageSize: 25,
      pageSizeOptions: [10, 25.5, 50],
    };

    expect(() => PaginationConfigSchema.parse(pagination)).toThrow();
  });
});

describe('Enhanced ListViewSchema', () => {
  it('should accept legacy string array columns', () => {
    const listView: ListView = {
      columns: ['name', 'email', 'phone'],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept enhanced column config array', () => {
    const listView: ListView = {
      columns: [
        { field: 'name', sortable: true },
        { field: 'email', width: 200 },
        { field: 'annual_revenue', align: 'right', type: 'currency' },
      ],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept grid features', () => {
    const listView: ListView = {
      columns: ['name', 'status'],
      resizable: true,
      striped: true,
      bordered: true,
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept selection configuration', () => {
    const listView: ListView = {
      columns: ['name', 'status'],
      selection: {
        type: 'multiple',
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept pagination configuration', () => {
    const listView: ListView = {
      columns: ['name', 'status'],
      pagination: {
        pageSize: 50,
        pageSizeOptions: [25, 50, 100],
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept complete enhanced list view', () => {
    const listView: ListView = {
      name: 'advanced_grid',
      label: 'Advanced Data Grid',
      type: 'grid',
      columns: [
        { 
          field: 'account_name', 
          label: 'Account Name',
          sortable: true, 
          resizable: true,
          width: 200,
        },
        { 
          field: 'industry', 
          width: 150,
          sortable: true,
        },
        { 
          field: 'annual_revenue', 
          label: 'Revenue',
          align: 'right', 
          type: 'currency',
          sortable: true,
          width: 150,
        },
        { 
          field: 'status', 
          width: 100,
        },
      ],
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
      sort: [{ field: 'annual_revenue', order: 'desc' }],
      searchableFields: ['account_name', 'industry'],
      resizable: true,
      striped: true,
      bordered: false,
      selection: {
        type: 'multiple',
      },
      pagination: {
        pageSize: 50,
        pageSizeOptions: [25, 50, 100, 200],
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });
});

describe('FormFieldSchema', () => {
  it('should accept minimal field config', () => {
    const field: FormField = {
      field: 'first_name',
    };

    expect(() => FormFieldSchema.parse(field)).not.toThrow();
  });

  it('should accept full field config', () => {
    const field: FormField = {
      field: 'email_address',
      label: 'Email Address',
      placeholder: 'Enter your email',
      helpText: 'We will never share your email',
      readonly: false,
      required: true,
      hidden: false,
      colSpan: 2,
      widget: 'email-input',
    };

    expect(() => FormFieldSchema.parse(field)).not.toThrow();
  });

  it('should accept field with conditional logic', () => {
    const field: FormField = {
      field: 'state',
      dependsOn: 'country',
      visibleWhen: 'country === "USA"',
    };

    expect(() => FormFieldSchema.parse(field)).not.toThrow();
  });

  it('should accept field with custom widget', () => {
    const field: FormField = {
      field: 'color_preference',
      widget: 'color-picker',
    };

    expect(() => FormFieldSchema.parse(field)).not.toThrow();
  });

  it('should reject colSpan less than 1', () => {
    const field = {
      field: 'test_field',
      colSpan: 0,
    };

    expect(() => FormFieldSchema.parse(field)).toThrow();
  });

  it('should reject colSpan greater than 4', () => {
    const field = {
      field: 'test_field',
      colSpan: 5,
    };

    expect(() => FormFieldSchema.parse(field)).toThrow();
  });

  it('should reject negative colSpan', () => {
    const field = {
      field: 'test_field',
      colSpan: -1,
    };

    expect(() => FormFieldSchema.parse(field)).toThrow();
  });

  it('should reject non-integer colSpan', () => {
    const field = {
      field: 'test_field',
      colSpan: 2.5,
    };

    expect(() => FormFieldSchema.parse(field)).toThrow();
  });

  it('should accept valid colSpan values (1-4)', () => {
    const validColSpans = [1, 2, 3, 4];
    
    validColSpans.forEach(colSpan => {
      const field: FormField = {
        field: 'test_field',
        colSpan,
      };
      expect(() => FormFieldSchema.parse(field)).not.toThrow();
    });
  });
});

describe('Enhanced FormSectionSchema', () => {
  it('should accept legacy string array fields', () => {
    const section = {
      fields: ['name', 'email', 'phone'],
    };

    expect(() => FormSectionSchema.parse(section)).not.toThrow();
  });

  it('should accept enhanced field config array', () => {
    const section = {
      label: 'Contact Information',
      fields: [
        { field: 'first_name', required: true },
        { field: 'last_name', required: true },
        { field: 'email', widget: 'email-input', colSpan: 2 },
      ],
    };

    expect(() => FormSectionSchema.parse(section)).not.toThrow();
  });

  it('should accept mixed field types (string and FormFieldSchema)', () => {
    const section = {
      label: 'User Profile',
      columns: '2',
      fields: [
        'username', // Simple string
        { field: 'email', required: true, widget: 'email-input' }, // Enhanced config
        'phone', // Simple string
        { 
          field: 'bio', 
          placeholder: 'Tell us about yourself',
          colSpan: 2,
        }, // Enhanced config
      ],
    };

    expect(() => FormSectionSchema.parse(section)).not.toThrow();
  });

  it('should accept section with conditional fields', () => {
    const section = {
      label: 'Address',
      columns: '2',
      fields: [
        { field: 'country', required: true },
        { 
          field: 'state', 
          dependsOn: 'country',
          visibleWhen: 'country === "USA"',
        },
        { 
          field: 'province', 
          dependsOn: 'country',
          visibleWhen: 'country === "Canada"',
        },
        'city',
        'postal_code',
      ],
    };

    expect(() => FormSectionSchema.parse(section)).not.toThrow();
  });
});

describe('Enhanced FormViewSchema with Complex Fields', () => {
  it('should accept form with enhanced field configurations', () => {
    const formView: FormView = {
      type: 'simple',
      sections: [
        {
          label: 'Basic Information',
          columns: '2',
          fields: [
            { field: 'first_name', required: true, placeholder: 'First name' },
            { field: 'last_name', required: true, placeholder: 'Last name' },
            { 
              field: 'email', 
              required: true, 
              widget: 'email-input',
              helpText: 'We will send confirmation to this email',
            },
            'phone',
          ],
        },
        {
          label: 'Address',
          collapsible: true,
          columns: '2',
          fields: [
            'street',
            'city',
            { 
              field: 'country', 
              required: true,
              widget: 'country-select',
            },
            { 
              field: 'state', 
              dependsOn: 'country',
              visibleWhen: 'country === "USA"',
              widget: 'state-select',
            },
          ],
        },
      ],
    };

    expect(() => FormViewSchema.parse(formView)).not.toThrow();
  });

  it('should accept tabbed form with enhanced fields', () => {
    const formView: FormView = {
      type: 'tabbed',
      sections: [
        {
          label: 'Personal',
          fields: [
            { field: 'name', required: true },
            { field: 'email', required: true, widget: 'email-input' },
          ],
        },
        {
          label: 'Preferences',
          fields: [
            { field: 'theme', widget: 'theme-selector' },
            { field: 'notifications', widget: 'toggle-group' },
          ],
        },
      ],
    };

    expect(() => FormViewSchema.parse(formView)).not.toThrow();
  });
});

describe('Real-World Enhanced View Examples', () => {
  it('should accept CRM account view with enhanced columns', () => {
    const accountViews: View = {
      list: {
        type: 'grid',
        columns: [
          { field: 'account_name', label: 'Account Name', sortable: true, width: 200 },
          { field: 'industry', sortable: true, width: 150 },
          { field: 'annual_revenue', align: 'right', type: 'currency', sortable: true },
          { field: 'employees', align: 'right', type: 'number', sortable: true },
          { field: 'status', width: 100 },
        ],
        resizable: true,
        striped: true,
        selection: {
          type: 'multiple',
        },
        pagination: {
          pageSize: 50,
          pageSizeOptions: [25, 50, 100],
        },
      },
      form: {
        type: 'tabbed',
        sections: [
          {
            label: 'Account Details',
            columns: '2',
            fields: [
              { field: 'account_name', required: true, colSpan: 2 },
              { field: 'industry', widget: 'industry-select' },
              { field: 'employees', widget: 'number-input' },
              { field: 'annual_revenue', widget: 'currency-input' },
              'website',
            ],
          },
          {
            label: 'Address',
            columns: '2',
            fields: [
              'billing_street',
              'billing_city',
              { field: 'billing_country', widget: 'country-select' },
              { 
                field: 'billing_state', 
                dependsOn: 'billing_country',
                visibleWhen: 'billing_country === "USA"',
              },
            ],
          },
        ],
      },
    };

    expect(() => ViewSchema.parse(accountViews)).not.toThrow();
  });

  it('should accept project management view with all enhancements', () => {
    const projectViews: View = {
      list: {
        type: 'grid',
        columns: [
          { field: 'project_name', sortable: true, width: 250, resizable: true },
          { field: 'status', width: 120, sortable: true },
          { field: 'priority', width: 100, align: 'center' },
          { field: 'start_date', type: 'date', sortable: true, width: 120 },
          { field: 'due_date', type: 'date', sortable: true, width: 120 },
          { field: 'completion', type: 'percent', align: 'right', width: 100 },
        ],
        resizable: true,
        striped: true,
        bordered: true,
        selection: {
          type: 'single',
        },
        pagination: {
          pageSize: 25,
          pageSizeOptions: [10, 25, 50, 100],
        },
      },
      form: {
        type: 'wizard',
        sections: [
          {
            label: 'Step 1: Project Basics',
            fields: [
              { 
                field: 'project_name', 
                required: true, 
                placeholder: 'Enter project name',
                helpText: 'Choose a descriptive name for your project',
              },
              { 
                field: 'description', 
                widget: 'rich-text-editor',
                helpText: 'Detailed project description',
              },
            ],
          },
          {
            label: 'Step 2: Timeline',
            columns: '2',
            fields: [
              { field: 'start_date', required: true, widget: 'date-picker' },
              { field: 'due_date', required: true, widget: 'date-picker' },
              { field: 'estimated_hours', widget: 'number-input' },
            ],
          },
          {
            label: 'Step 3: Team',
            fields: [
              { field: 'project_manager', required: true, widget: 'user-lookup' },
              { field: 'team_members', widget: 'multi-user-lookup' },
            ],
          },
        ],
      },
    };

    expect(() => ViewSchema.parse(projectViews)).not.toThrow();
  });
});

describe('ColumnSummarySchema', () => {
  it('should accept all summary functions', () => {
    const functions = [
      'none', 'count', 'count_empty', 'count_filled', 'count_unique',
      'percent_empty', 'percent_filled', 'sum', 'avg', 'min', 'max',
    ] as const;

    functions.forEach(fn => {
      expect(() => ColumnSummarySchema.parse(fn)).not.toThrow();
    });
  });

  it('should reject invalid summary function', () => {
    expect(() => ColumnSummarySchema.parse('median')).toThrow();
  });
});

describe('RowHeightSchema', () => {
  it('should accept all row height options', () => {
    const heights = ['compact', 'short', 'medium', 'tall', 'extra_tall'] as const;

    heights.forEach(h => {
      expect(() => RowHeightSchema.parse(h)).not.toThrow();
    });
  });

  it('should reject invalid row height', () => {
    expect(() => RowHeightSchema.parse('huge')).toThrow();
  });
});

describe('GroupingConfigSchema', () => {
  it('should accept single field grouping', () => {
    const grouping = {
      fields: [{ field: 'status' }],
    };

    const result = GroupingConfigSchema.parse(grouping);
    expect(result.fields[0].order).toBe('asc');
    expect(result.fields[0].collapsed).toBe(false);
  });

  it('should accept multi-level grouping', () => {
    const grouping = {
      fields: [
        { field: 'department', order: 'asc' as const },
        { field: 'status', order: 'desc' as const, collapsed: true },
      ],
    };

    expect(() => GroupingConfigSchema.parse(grouping)).not.toThrow();
  });

  it('should reject empty fields array', () => {
    const grouping = { fields: [] };

    expect(() => GroupingConfigSchema.parse(grouping)).toThrow();
  });

  it('fields .describe() states shape semantics without a fixed level cap (#7084)', () => {
    const shape = (GroupingConfigSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    const doc = shape.fields!.description ?? '';

    // Non-empty arm FIRST — the negative arms below pass vacuously on '',
    // so this arm is what makes them non-vacuous (the #6918 demonstration).
    expect(doc.length, 'fields .describe() must not be empty').toBeGreaterThan(0);

    // Substance, by idiom not verbatim: array order IS nesting order, and the
    // gate's real lower bound (`.min(1)`) is stated.
    expect(doc).toMatch(/nesting order/i);
    expect(doc).toMatch(/outermost/i);
    expect(doc).toMatch(/at least one/i);

    // The #7084 defect must not return under a new number: the gate is
    // `.min(1)` with NO upper bound, and nothing downstream enforces one
    // either (objectui useGroupedData's buildLevel recurses over ALL
    // configured levels — its only stop is `depth >= fields.length`). So any
    // fixed-count support envelope here is prose the acceptance face does not
    // have; house rule E17 says "up to N" is the same defect as "up to 3".
    expect(doc).not.toMatch(/\bup to \d+\b/i);
    expect(doc).not.toMatch(/\b\d+\s+levels?\b/i);
    expect(doc).not.toMatch(/\bmax(?:imum)?(?:\s+of)?\s+\d+\b/i);
  });
});

describe('GroupingFieldSchema', () => {
  it('should accept minimal grouping field', () => {
    const field = { field: 'category' };

    const result = GroupingFieldSchema.parse(field);
    expect(result.order).toBe('asc');
    expect(result.collapsed).toBe(false);
  });

  it('should accept full grouping field config', () => {
    const field = { field: 'priority', order: 'desc' as const, collapsed: true };

    expect(() => GroupingFieldSchema.parse(field)).not.toThrow();
  });
});

describe('GalleryConfigSchema', () => {
  it('should accept minimal gallery config', () => {
    const gallery = {};

    const result = GalleryConfigSchema.parse(gallery);
    expect(result.coverFit).toBe('cover');
    expect(result.cardSize).toBe('medium');
  });

  it('should accept full gallery config', () => {
    const gallery = {
      coverField: 'photo',
      coverFit: 'contain' as const,
      cardSize: 'large' as const,
      titleField: 'name',
      visibleFields: ['status', 'category', 'owner'],
    };

    expect(() => GalleryConfigSchema.parse(gallery)).not.toThrow();
  });

  it('should accept all card sizes', () => {
    const sizes = ['small', 'medium', 'large'] as const;

    sizes.forEach(size => {
      expect(() => GalleryConfigSchema.parse({ cardSize: size })).not.toThrow();
    });
  });

  it('should accept all cover fit modes', () => {
    const fits = ['cover', 'contain'] as const;

    fits.forEach(fit => {
      expect(() => GalleryConfigSchema.parse({ coverFit: fit })).not.toThrow();
    });
  });
});

describe('TimelineConfigSchema', () => {
  it('should accept minimal timeline config', () => {
    const timeline = {
      startDateField: 'start_date',
      titleField: 'name',
    };

    const result = TimelineConfigSchema.parse(timeline);
    expect(result.scale).toBe('week');
  });

  it('should accept full timeline config', () => {
    const timeline = {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'project_name',
      groupByField: 'team',
      colorField: 'priority',
      scale: 'month' as const,
    };

    expect(() => TimelineConfigSchema.parse(timeline)).not.toThrow();
  });

  it('should accept all scale options', () => {
    const scales = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

    scales.forEach(scale => {
      expect(() => TimelineConfigSchema.parse({
        startDateField: 'start_date',
        titleField: 'name',
        scale,
      })).not.toThrow();
    });
  });

  it('should require startDateField and titleField', () => {
    expect(() => TimelineConfigSchema.parse({})).toThrow();
    expect(() => TimelineConfigSchema.parse({ startDateField: 'start' })).toThrow();
    expect(() => TimelineConfigSchema.parse({ titleField: 'name' })).toThrow();
  });
});

describe('ViewSharingSchema', () => {
  it('should default to collaborative', () => {
    const sharing = {};

    const result = ViewSharingSchema.parse(sharing);
    expect(result.type).toBe('collaborative');
  });

  it('should accept personal view', () => {
    const sharing = {
      type: 'personal' as const,
      lockedBy: 'user_123',
    };

    expect(() => ViewSharingSchema.parse(sharing)).not.toThrow();
  });

  it('should accept collaborative view with lock', () => {
    const sharing = {
      type: 'collaborative' as const,
      lockedBy: 'admin_user',
    };

    expect(() => ViewSharingSchema.parse(sharing)).not.toThrow();
  });
});

describe('RowColorConfigSchema', () => {
  it('should accept minimal row color config', () => {
    const rowColor = { field: 'status' };

    expect(() => RowColorConfigSchema.parse(rowColor)).not.toThrow();
  });

  it('should accept row color config with color map', () => {
    const rowColor = {
      field: 'priority',
      colors: {
        high: '#ff0000',
        medium: '#ffaa00',
        low: '#00cc00',
      },
    };

    expect(() => RowColorConfigSchema.parse(rowColor)).not.toThrow();
  });

  it('should require field', () => {
    expect(() => RowColorConfigSchema.parse({})).toThrow();
  });
});

describe('ListColumnSchema pinned and summary', () => {
  it('should accept pinned column', () => {
    const column: ListColumn = {
      field: 'name',
      pinned: 'left',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept right-pinned column', () => {
    const column: ListColumn = {
      field: 'actions',
      pinned: 'right',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept column with summary', () => {
    const column: ListColumn = {
      field: 'amount',
      summary: 'sum',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept column with pinned and summary', () => {
    const column: ListColumn = {
      field: 'revenue',
      pinned: 'left',
      summary: 'avg',
      align: 'right',
      type: 'currency',
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should reject invalid pinned value', () => {
    const column = {
      field: 'test_field',
      pinned: 'top',
    };

    expect(() => ListColumnSchema.parse(column)).toThrow();
  });
});

describe('ListColumnSchema summary object form and prefix (objectui#2231)', () => {
  it('should accept the { type, field } summary form aggregating another field', () => {
    const column: ListColumn = {
      field: 'amount',
      summary: { type: 'sum', field: 'amount_in_base_currency' },
    };

    expect(ListColumnSchema.parse(column)).toMatchObject({
      summary: { type: 'sum', field: 'amount_in_base_currency' },
    });
  });

  it('should accept the object form without a field override', () => {
    expect(() => ListColumnSchema.parse({ field: 'amount', summary: { type: 'avg' } })).not.toThrow();
  });

  it('should share one aggregation vocabulary across both summary forms', () => {
    for (const fn of ColumnSummarySchema.options) {
      expect(() => ListColumnSchema.parse({ field: 'amount', summary: fn })).not.toThrow();
      expect(() => ListColumnSchema.parse({ field: 'amount', summary: { type: fn } })).not.toThrow();
    }
  });

  it('should reject an unknown aggregation in either form', () => {
    expect(() => ListColumnSchema.parse({ field: 'amount', summary: 'median' })).toThrow();
    expect(() => ListColumnSchema.parse({ field: 'amount', summary: { type: 'median' } })).toThrow();
  });

  it('should accept a compound-cell prefix and default its render type to text', () => {
    expect(ListColumnSchema.parse({ field: 'name', prefix: { field: 'status' } })).toMatchObject({
      prefix: { field: 'status', type: 'text' },
    });
  });

  it('should accept a badge prefix', () => {
    const column: ListColumn = {
      field: 'name',
      prefix: { field: 'status', type: 'badge' },
    };

    expect(() => ListColumnSchema.parse(column)).not.toThrow();
  });

  it('should reject a prefix with no field or an unknown render type', () => {
    expect(() => ListColumnSchema.parse({ field: 'name', prefix: {} })).toThrow();
    expect(() => ListColumnSchema.parse({ field: 'name', prefix: { field: 'status', type: 'chip' } })).toThrow();
  });
});

describe('Airtable-style ListView enhancements', () => {
  it('should accept list view with row height', () => {
    const listView: ListView = {
      columns: ['name', 'status'],
      rowHeight: 'compact',
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with grouping', () => {
    const listView: ListView = {
      columns: ['name', 'status', 'department'],
      grouping: {
        fields: [
          { field: 'department', order: 'asc' },
          { field: 'status', order: 'desc', collapsed: true },
        ],
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with row color', () => {
    const listView: ListView = {
      columns: ['name', 'priority'],
      rowColor: {
        field: 'priority',
        colors: {
          critical: '#ff0000',
          high: '#ff8800',
          medium: '#ffcc00',
          low: '#00cc00',
        },
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with hidden fields and field order', () => {
    const listView: ListView = {
      columns: ['name', 'status', 'owner'],
      hiddenFields: ['internal_notes', 'system_id'],
      fieldOrder: ['name', 'status', 'owner', 'created_at'],
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept list view with description and sharing', () => {
    const listView: ListView = {
      name: 'my_pipeline',
      label: 'My Pipeline',
      columns: ['name', 'stage'],
      description: 'Personal view for tracking deals',
      sharing: {
        type: 'personal',
      },
    };

    expect(() => ListViewSchema.parse(listView)).not.toThrow();
  });

  it('should accept gallery view with gallery config', () => {
    const galleryView: ListView = {
      type: 'gallery',
      columns: ['name', 'photo', 'category'],
      gallery: {
        coverField: 'photo',
        coverFit: 'cover',
        cardSize: 'large',
        titleField: 'name',
        visibleFields: ['category', 'price'],
      },
    };

    expect(() => ListViewSchema.parse(galleryView)).not.toThrow();
  });

  it('should accept timeline view with timeline config', () => {
    const timelineView: ListView = {
      type: 'timeline',
      columns: ['name', 'start_date', 'end_date', 'team'],
      timeline: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'name',
        groupByField: 'team',
        colorField: 'status',
        scale: 'month',
      },
    };

    expect(() => ListViewSchema.parse(timelineView)).not.toThrow();
  });

  it('should accept full Airtable-style grid view', () => {
    const airtableView: ListView = {
      name: 'project_tracker',
      label: 'Project Tracker',
      description: 'Main project tracking view with all features',
      type: 'grid',
      columns: [
        { field: 'project_name', pinned: 'left', sortable: true, width: 250 },
        { field: 'status', width: 120, summary: 'count_unique' },
        { field: 'priority', width: 100 },
        { field: 'budget', align: 'right', type: 'currency', summary: 'sum' },
        { field: 'completion', align: 'right', type: 'percent', summary: 'avg' },
      ],
      filter: [{ field: 'archived', operator: 'equals', value: false }],
      sort: [{ field: 'priority', order: 'asc' }],
      grouping: {
        fields: [
          { field: 'department', order: 'asc' },
        ],
      },
      rowHeight: 'medium',
      rowColor: {
        field: 'status',
        colors: {
          on_track: '#22c55e',
          at_risk: '#f59e0b',
          blocked: '#ef4444',
        },
      },
      hiddenFields: ['internal_id', 'sys_updated_at'],
      fieldOrder: ['project_name', 'status', 'priority', 'budget', 'completion', 'department'],
      sharing: {
        type: 'collaborative',
        lockedBy: 'admin',
      },
      resizable: true,
      selection: { type: 'multiple' },
      pagination: { pageSize: 50, pageSizeOptions: [25, 50, 100] },
      inlineEdit: true,
      exportOptions: ['csv', 'xlsx'],
    };

    expect(() => ListViewSchema.parse(airtableView)).not.toThrow();
  });

  it('should accept complete Airtable-style View container with multiple view types', () => {
    const views: View = {
      list: {
        type: 'grid',
        columns: [
          { field: 'name', pinned: 'left', sortable: true },
          { field: 'status', summary: 'count' },
          { field: 'amount', summary: 'sum', align: 'right' },
        ],
        rowHeight: 'short',
        grouping: {
          fields: [{ field: 'category' }],
        },
      },
      listViews: {
        kanban: {
          type: 'kanban',
          columns: ['name', 'amount', 'owner'],
          kanban: {
            groupByField: 'stage',
            summarizeField: 'amount',
            columns: ['name', 'owner', 'close_date'],
          },
          sharing: { type: 'collaborative' },
        },
        gallery: {
          type: 'gallery',
          columns: ['name', 'photo', 'price'],
          gallery: {
            coverField: 'photo',
            cardSize: 'medium',
            titleField: 'name',
            visibleFields: ['price', 'category'],
          },
          rowHeight: 'tall',
        },
        timeline: {
          type: 'timeline',
          columns: ['name', 'start_date', 'end_date'],
          timeline: {
            startDateField: 'start_date',
            endDateField: 'end_date',
            titleField: 'name',
            scale: 'week',
          },
        },
        calendar: {
          type: 'calendar',
          columns: ['subject', 'date'],
          calendar: {
            startDateField: 'date',
            titleField: 'subject',
          },
        },
      },
      form: {
        type: 'simple',
        sections: [{ fields: ['name', 'status', 'amount'] }],
      },
    };

    expect(() => ViewSchema.parse(views)).not.toThrow();
  });
});

// ============================================================================
// Protocol Improvement Tests: FormView defaultSort
// ============================================================================

describe('FormViewSchema — retired defaultSort (#3896 close-out)', () => {
  it('REJECTS the retired `defaultSort` and points at the related list view', () => {
    let message = '';
    try {
      FormViewSchema.parse({
        type: 'simple', sections: [{ fields: ['name'] }],
        defaultSort: [{ field: 'created_at', order: 'desc' }],
      });
    } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/list view/);
    expect(message).toMatch(/#3896/);
  });
  it('a form without it still parses', () => {
    expect(() => FormViewSchema.parse({ type: 'simple', sections: [{ fields: ['name'] }] })).not.toThrow();
  });
});

describe('FormViewSchema - buttons & defaults', () => {
  it('should accept structured button config with visibility and labels', () => {
    const result = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name'] }],
      buttons: {
        submit: { show: true, label: 'Save' },
        cancel: { show: true, label: 'Discard' },
        reset: { show: false },
      },
    });
    expect(result.buttons?.submit).toEqual({ show: true, label: 'Save' });
    expect(result.buttons?.reset).toEqual({ show: false });
  });

  it('should accept a partial buttons block (each button optional)', () => {
    const result = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name'] }],
      buttons: { submit: { label: 'Create' } },
    });
    expect(result.buttons?.submit?.label).toBe('Create');
    expect(result.buttons?.cancel).toBeUndefined();
  });

  it('should reject unknown keys inside buttons (strict leaf, ADR-0089 D3a)', () => {
    expect(() => FormViewSchema.parse({
      type: 'simple',
      buttons: { submit: { text: 'Save' } }, // legacy `submitText`-style key
    })).toThrow();
    expect(() => FormViewSchema.parse({
      type: 'simple',
      buttons: { showSubmit: true }, // flat renderer-invented key
    })).toThrow();
  });

  it('should accept defaults as a field-name → value record', () => {
    const result = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name', 'status', 'priority'] }],
      defaults: { status: 'open', priority: 3, tags: ['a', 'b'] },
    });
    expect(result.defaults).toEqual({ status: 'open', priority: 3, tags: ['a', 'b'] });
  });

  it('should accept form view without buttons/defaults (optional)', () => {
    const result = FormViewSchema.parse({ type: 'simple' });
    expect(result.buttons).toBeUndefined();
    expect(result.defaults).toBeUndefined();
  });

  it('marks both keys live now the ObjectForm renderer folds them (framework#1894 / #2998)', () => {
    const shape = (FormViewSchema as unknown as z.ZodObject<z.ZodRawShape>).shape;
    for (const key of ['buttons', 'defaults'] as const) {
      // The renderer wiring landed (objectui ObjectForm foldFormButtons), so the
      // ADR-0078 escape-hatch marker must be gone — the spec liveness gate keys
      // `experimental` off this exact substring.
      expect(shape[key].description, `${key} .describe()`).not.toMatch(/EXPERIMENTAL — NOT ENFORCED/);
    }
  });
});

describe('defineView', () => {
  it('should return a parsed view with list config', () => {
    const result = defineView({
      list: {
        type: 'grid',
        columns: ['name', 'status'],
      },
    });
    expect(result.list).toBeDefined();
    expect(result.list?.type).toBe('grid');
    expect(result.list?.columns).toEqual(['name', 'status']);
  });

  it('should return a parsed view with form config', () => {
    const result = defineView({
      form: {
        type: 'simple',
        sections: [{ fields: ['name', 'email'] }],
      },
    });
    expect(result.form).toBeDefined();
    expect(result.form?.type).toBe('simple');
  });

  it('should return a parsed view with list and form', () => {
    const result = defineView({
      list: { type: 'kanban', columns: ['name'] },
      form: { type: 'tabbed', sections: [{ fields: ['name'] }] },
    });
    expect(result.list?.type).toBe('kanban');
    expect(result.form?.type).toBe('tabbed');
  });

  it('should accept named list views', () => {
    const result = defineView({
      list: { type: 'grid', columns: ['name'] },
      listViews: {
        active: { type: 'grid', columns: ['name', 'status'] },
      },
    });
    expect(result.listViews?.active).toBeDefined();
  });

  it('should throw on invalid view config', () => {
    expect(() => defineView({
      list: { type: 'invalid_type' as 'grid', columns: ['name'] },
    })).toThrow();
  });

  it('should throw on an empty container (zero views)', () => {
    expect(() => defineView({})).toThrow(/defines no views/);
  });

  it('should throw on a flat list view, now at the PARSE and so at both doors', () => {
    // The `defineView` guard was written because `ViewSchema` stripped unknown
    // top-level keys, so a flat view parsed to an empty container. Like every
    // other bespoke guard this campaign has found, it covered ONE door —
    // `defineView` — while the metadata door (Studio, the API, an agent) got the
    // empty container in silence.
    //
    // Closing the shape (#4001) moves the rejection into the parse, so it reaches
    // both, and it carries the wrap instruction rather than only the symptom.
    // Assert the prescription, not which layer produced it.
    expect(() => defineView({
      name: 'all_tasks',
      label: 'All Tasks',
      type: 'grid',
      columns: ['name', 'status'],
    } as never)).toThrow(/belongs to a single VIEW, not to the container/);
  });

  it('still throws on an EMPTY container — the case strict cannot see', () => {
    // `defineView({})` has no unknown keys, so the parse is happy and zero views
    // register. That is why the guard stays rather than retiring with the
    // stripping it was written to work around.
    expect(() => defineView({} as never)).toThrow(/defines no views/);
  });
});

// ---------------------------------------------------------------------------
// Phase C: FormViewSchema public sharing
// ---------------------------------------------------------------------------
describe('FormViewSchema sharing', () => {
  it('should accept form with sharing config', () => {
    const form = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name', 'email'] }],
      sharing: {
        enabled: true,
        publicLink: 'https://app.example.com/form/contact',
        allowAnonymous: true,
      },
    });

    expect(form.sharing?.enabled).toBe(true);
    expect(form.sharing?.allowAnonymous).toBe(true);
  });

  it('should accept form with sharing password and expiration', () => {
    const form = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name'] }],
      sharing: {
        enabled: true,
        password: 'formpass',
        expiresAt: '2027-12-31T23:59:59Z',
      },
    });

    expect(form.sharing?.password).toBe('formpass');
    expect(form.sharing?.expiresAt).toBe('2027-12-31T23:59:59Z');
  });

  it('should accept form without sharing (backward compatibility)', () => {
    const form = FormViewSchema.parse({
      type: 'simple',
      sections: [{ fields: ['name'] }],
    });

    expect(form.sharing).toBeUndefined();
  });
});

// ============================================================================
// Airtable Interface Parity — New schemas
// ============================================================================

describe('VisualizationTypeSchema', () => {
  it('should accept all visualization types', () => {
    const types = ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map'] as const;

    types.forEach(type => {
      expect(() => VisualizationTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid visualization type', () => {
    expect(() => VisualizationTypeSchema.parse('spreadsheet')).toThrow();
  });
});

describe('UserActionsConfigSchema', () => {
  it('should apply default values', () => {
    const config = UserActionsConfigSchema.parse({});
    expect(config.sort).toBe(true);
    expect(config.search).toBe(true);
    expect(config.filter).toBe(true);
    expect(config.refresh).toBe(true);
    expect(config.rowHeight).toBe(true);
    expect(config.addRecordForm).toBe(false);
    expect(config.editInline).toBe(false);
    expect(config.buttons).toBeUndefined();
  });

  it('should accept full configuration', () => {
    const config = UserActionsConfigSchema.parse({
      sort: false,
      search: true,
      filter: false,
      rowHeight: true,
      addRecordForm: true,
      editInline: true,
      buttons: ['btn_export', 'btn_archive'],
    });
    expect(config.sort).toBe(false);
    expect(config.filter).toBe(false);
    expect(config.addRecordForm).toBe(true);
    expect(config.editInline).toBe(true);
    expect(config.buttons).toEqual(['btn_export', 'btn_archive']);
  });

  it('should accept partial configuration', () => {
    const config = UserActionsConfigSchema.parse({
      sort: false,
      search: false,
    });
    expect(config.sort).toBe(false);
    expect(config.search).toBe(false);
    expect(config.filter).toBe(true);
  });
});

describe('AppearanceConfigSchema', () => {
  it('should apply default values', () => {
    const config = AppearanceConfigSchema.parse({});
    expect(config.showDescription).toBe(true);
    expect(config.allowedVisualizations).toBeUndefined();
  });

  it('should accept full configuration', () => {
    const config = AppearanceConfigSchema.parse({
      showDescription: false,
      allowedVisualizations: ['grid', 'gallery', 'kanban'],
    });
    expect(config.showDescription).toBe(false);
    expect(config.allowedVisualizations).toEqual(['grid', 'gallery', 'kanban']);
  });

  it('should reject invalid visualization in whitelist', () => {
    expect(() => AppearanceConfigSchema.parse({
      allowedVisualizations: ['grid', 'invalid_type'],
    })).toThrow();
  });
});

describe('ViewTabSchema', () => {
  it('should accept minimal tab', () => {
    const tab = ViewTabSchema.parse({
      name: 'my_customers',
    });
    expect(tab.name).toBe('my_customers');
    expect(tab.pinned).toBe(false);
    expect(tab.isDefault).toBe(false);
    expect(tab.visible).toBe(true);
  });

  it('should accept full tab configuration', () => {
    const tab = ViewTabSchema.parse({
      name: 'all_records',
      label: 'All Records',
      icon: 'list',
      view: 'all_contacts',
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
      order: 1,
      pinned: true,
      isDefault: true,
      visible: true,
    });
    expect(tab.label).toBe('All Records');
    expect(tab.icon).toBe('list');
    expect(tab.pinned).toBe(true);
    expect(tab.isDefault).toBe(true);
    expect(tab.order).toBe(1);
  });

  it('should reject non-snake_case tab name', () => {
    expect(() => ViewTabSchema.parse({
      name: 'My Tab',
    })).toThrow();
  });
});

describe('UserFiltersSchema (ADR-0047)', () => {
  it('should default element to dropdown', () => {
    const uf = UserFiltersSchema.parse({});
    expect(uf.element).toBe('dropdown');
  });

  it('should accept dropdown fields with inference defaults', () => {
    const uf = UserFiltersSchema.parse({
      element: 'dropdown',
      fields: [
        { field: 'industry' },
        { field: 'rating', label: '评级', showCount: true },
      ],
    });
    expect(uf.fields).toHaveLength(2);
    expect(uf.fields?.[0].type).toBeUndefined(); // inferred by renderer
  });

  it('should accept tabs element reusing ViewTabSchema presets', () => {
    const uf = UserFiltersSchema.parse({
      element: 'tabs',
      showAllRecords: true,
      tabs: [
        { name: 'tech_companies', label: '科技公司', filter: [{ field: 'industry', operator: 'equals', value: 'technology' }] },
        { name: 'finance_companies', label: '金融公司', filter: [{ field: 'industry', operator: 'equals', value: 'finance' }], isDefault: true },
      ],
    });
    expect(uf.tabs).toHaveLength(2);
    expect(uf.tabs?.[1].isDefault).toBe(true);
  });

  it('should accept static options with values and colors', () => {
    const uf = UserFiltersSchema.parse({
      fields: [{
        field: 'status',
        type: 'select',
        options: [
          { value: 'active', label: 'Active', color: '#22c55e' },
          { value: 1, label: 'One' },
          { value: true, label: 'Yes' },
        ],
        defaultValues: ['active'],
      }],
    });
    expect(uf.fields?.[0].options).toHaveLength(3);
    expect(uf.fields?.[0].defaultValues).toEqual(['active']);
  });

  it('should reject unknown element style', () => {
    expect(() => UserFiltersSchema.parse({ element: 'sidebar' })).toThrow();
  });

  it('should accept allowAddTab on the tabs element (#5073 — promoted from objectui)', () => {
    const uf = UserFiltersSchema.parse({
      element: 'tabs',
      allowAddTab: true,
      tabs: [{ name: 'mine', label: 'Mine', filter: [] }],
    });
    expect(uf.allowAddTab).toBe(true);
  });

  it('should reject an unknown key (#5073 — this shape is closed)', () => {
    expect(() => UserFiltersSchema.parse({ element: 'dropdown', allowAddTabb: true })).toThrow();
  });

  it('should attach to ListViewSchema.userFilters', () => {
    const view = ListViewSchema.parse({
      type: 'grid',
      columns: ['name', 'industry'],
      userFilters: {
        element: 'dropdown',
        fields: [{ field: 'industry' }],
      },
    });
    expect(view.userFilters?.element).toBe('dropdown');
    expect(view.userFilters?.fields?.[0].field).toBe('industry');
  });
});

describe('AddRecordConfigSchema', () => {
  it('should apply default values', () => {
    const config = AddRecordConfigSchema.parse({});
    expect(config.enabled).toBe(true);
    expect(config.position).toBe('bottom');
    expect(config.mode).toBe('inline');
    expect(config.formView).toBeUndefined();
  });

  it('should accept full configuration', () => {
    const config = AddRecordConfigSchema.parse({
      enabled: true,
      position: 'top',
      mode: 'form',
      formView: 'quick_create',
    });
    expect(config.position).toBe('top');
    expect(config.mode).toBe('form');
    expect(config.formView).toBe('quick_create');
  });

  it('should accept all position values', () => {
    const positions = ['top', 'bottom', 'both'] as const;
    positions.forEach(position => {
      expect(() => AddRecordConfigSchema.parse({ position })).not.toThrow();
    });
  });

  it('should accept all mode values', () => {
    const modes = ['inline', 'form', 'modal'] as const;
    modes.forEach(mode => {
      expect(() => AddRecordConfigSchema.parse({ mode })).not.toThrow();
    });
  });

  it('should accept disabled add record', () => {
    const config = AddRecordConfigSchema.parse({ enabled: false });
    expect(config.enabled).toBe(false);
  });
});

describe('ListViewSchema — Airtable Interface parity fields', () => {
  it('should accept list view with userActions', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      userActions: {
        sort: true,
        search: true,
        filter: false,
        refresh: false,
        rowHeight: false,
      },
    });
    expect(listView.userActions?.sort).toBe(true);
    expect(listView.userActions?.filter).toBe(false);
    expect(listView.userActions?.refresh).toBe(false);
  });

  it('should accept list view with appearance', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      appearance: {
        showDescription: true,
        allowedVisualizations: ['grid', 'gallery', 'kanban'],
      },
    });
    expect(listView.appearance?.showDescription).toBe(true);
    expect(listView.appearance?.allowedVisualizations).toHaveLength(3);
  });

  it('should accept list view with tabs', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      tabs: [
        { name: 'my_customers', label: 'My Customers', isDefault: true },
        { name: 'all_records', label: 'All Records' },
      ],
    });
    expect(listView.tabs).toHaveLength(2);
    expect(listView.tabs![0].isDefault).toBe(true);
  });

  it('should accept list view with addRecord', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      addRecord: {
        enabled: true,
        position: 'bottom',
        mode: 'form',
        formView: 'quick_create',
      },
    });
    expect(listView.addRecord?.mode).toBe('form');
    expect(listView.addRecord?.formView).toBe('quick_create');
  });

  it('should accept list view with showRecordCount', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      showRecordCount: true,
    });
    expect(listView.showRecordCount).toBe(true);
  });

  it('should accept list view with allowPrinting', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      allowPrinting: true,
    });
    expect(listView.allowPrinting).toBe(true);
  });

  it('should accept full Airtable Interface-style list view', () => {
    const listView = ListViewSchema.parse({
      name: 'customer_list',
      label: '客户列表页面',
      description: '浏览并筛选所有客户信息',
      type: 'grid',
      columns: [
        { field: 'customer_name', pinned: 'left', sortable: true },
        { field: 'industry', width: 150 },
        { field: 'region', width: 120 },
        { field: 'account_owner', width: 120 },
      ],
      sort: [{ field: 'customer_name', order: 'asc' }],
      rowHeight: 'medium',
      userActions: {
        sort: true,
        search: true,
        filter: true,
        rowHeight: true,
        addRecordForm: false,
        buttons: [],
      },
      appearance: {
        showDescription: true,
        allowedVisualizations: ['grid', 'gallery', 'kanban'],
      },
      tabs: [
        { name: 'my_customers', label: 'my customers', isDefault: true, pinned: true },
        { name: 'all_records', label: 'All records' },
      ],
      addRecord: {
        enabled: true,
        position: 'bottom',
        mode: 'inline',
      },
      showRecordCount: true,
      allowPrinting: true,
    });
    expect(listView.name).toBe('customer_list');
    expect(listView.userActions?.sort).toBe(true);
    expect(listView.appearance?.allowedVisualizations).toHaveLength(3);
    expect(listView.tabs).toHaveLength(2);
    expect(listView.showRecordCount).toBe(true);
    expect(listView.allowPrinting).toBe(true);
  });

  it('should maintain backward compatibility with existing list view config', () => {
    const listView = ListViewSchema.parse({
      columns: ['name', 'status'],
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
    });
    expect(listView.userActions).toBeUndefined();
    expect(listView.appearance).toBeUndefined();
    expect(listView.tabs).toBeUndefined();
    expect(listView.addRecord).toBeUndefined();
    expect(listView.showRecordCount).toBeUndefined();
    expect(listView.allowPrinting).toBeUndefined();
  });
});

// ============================================================================
// ViewFilterRuleSchema Tests
// ============================================================================

describe('ViewFilterRuleSchema', () => {
  it('should accept a filter rule with field, operator, and value', () => {
    const rule = ViewFilterRuleSchema.parse({
      field: 'status',
      operator: 'equals',
      value: 'active',
    });
    expect(rule.field).toBe('status');
    expect(rule.operator).toBe('equals');
    expect(rule.value).toBe('active');
  });

  it('should accept a unary filter rule without value', () => {
    const rule = ViewFilterRuleSchema.parse({
      field: 'archived_at',
      operator: 'is_empty',
    });
    expect(rule.value).toBeUndefined();
  });

  it('should accept boolean and number filter values', () => {
    expect(() => ViewFilterRuleSchema.parse({ field: 'archived', operator: 'equals', value: false })).not.toThrow();
    expect(() => ViewFilterRuleSchema.parse({ field: 'amount', operator: 'greater_than_or_equal', value: 1000 })).not.toThrow();
  });

  it('should normalize legacy operator aliases to canonical', () => {
    expect(ViewFilterRuleSchema.parse({ field: 'amount', operator: 'gte', value: 1 }).operator).toBe('greater_than_or_equal');
    expect(ViewFilterRuleSchema.parse({ field: 'amount', operator: 'gt', value: 1 }).operator).toBe('greater_than');
    expect(ViewFilterRuleSchema.parse({ field: 'name', operator: 'eq', value: 'x' }).operator).toBe('equals');
    expect(ViewFilterRuleSchema.parse({ field: 'name', operator: 'notEquals', value: 'x' }).operator).toBe('not_equals');
    expect(ViewFilterRuleSchema.parse({ field: 'revoked_at', operator: 'isNull' }).operator).toBe('is_null');
    expect(ViewFilterRuleSchema.parse({ field: 'tags', operator: 'nin', value: ['a'] }).operator).toBe('not_in');
  });

  it('should reject a genuinely unknown operator', () => {
    expect(() => ViewFilterRuleSchema.parse({ field: 'close_date', operator: 'this_quarter' })).toThrow();
    expect(() => ViewFilterRuleSchema.parse({ field: 'x', operator: 'totally_bogus' })).toThrow();
  });

  it('should accept array filter values (for IN operator)', () => {
    expect(() => ViewFilterRuleSchema.parse({
      field: 'status',
      operator: 'in',
      value: ['active', 'pending'],
    })).not.toThrow();
  });

  it('should reject filter rule without field', () => {
    expect(() => ViewFilterRuleSchema.parse({ operator: 'equals', value: 'x' })).toThrow();
  });

  it('should reject filter rule without operator', () => {
    expect(() => ViewFilterRuleSchema.parse({ field: 'status', value: 'x' })).toThrow();
  });
});

describe('ListViewSchema filter field', () => {
  it('should accept typed filter array', () => {
    const view = ListViewSchema.parse({
      type: 'grid',
      columns: ['name', 'status'],
      filter: [
        { field: 'status', operator: 'equals', value: 'active' },
        { field: 'archived', operator: 'equals', value: false },
      ],
    });
    expect(view.filter).toHaveLength(2);
  });

  it('should reject filter with non-object entries', () => {
    expect(() => ListViewSchema.parse({
      type: 'grid',
      columns: ['name'],
      filter: ['invalid_string'],
    })).toThrow();
  });
});

// ============================================================================
// Issue #7: ListView responsive and performance config
// ============================================================================
describe('ListViewSchema — retired responsive/performance (#3896 close-out)', () => {
  it('REJECTS the retired `responsive` with the prescription', () => {
    expect(() => ListViewSchema.parse({
      type: 'grid', columns: ['name'], responsive: { hiddenOn: ['xs'] },
    })).toThrow(/responsive.*removed|removed.*responsive/s);
  });
  it('REJECTS the retired `performance` with the prescription', () => {
    let message = '';
    try {
      ListViewSchema.parse({ type: 'grid', columns: ['name'], performance: { lazyLoad: true } });
    } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/#3896/);
  });
});

describe('HttpMethodSubsetSchema/HttpRequestSchema backward compat', () => {
  it('should still be importable from view.zod', () => {
    expect(HttpMethodSubsetSchema).toBeDefined();
    expect(HttpRequestSchema).toBeDefined();
  });

  it('should still parse correctly when imported from view.zod', () => {
    expect(HttpMethodSubsetSchema.parse('GET')).toBe('GET');
    const result = HttpRequestSchema.parse({ url: '/api/test' });
    expect(result.method).toBe('GET');
  });
});

// ─── [#4688] Dual-source regression pin ──────────────────────────────
//
// RUNTIME assertions, deliberately. #4642 established that a compile-time pin in
// `packages/spec` was a no-op until #5286: `tsconfig.json` excluded `**/*.test.ts` and
// `vitest.config.ts` never enables `typecheck`, so neither path type-checked a
// test file. A conditional-type `Assert< Equal< … > >` here was dead text until
// #5286. One half of that argument survives #5286 untouched and is why these
// stay runtime assertions: the bare `type HttpRequest` import at the top of this
// file proves nothing about the export still existing, because vitest's
// transform erases it. The third test below is what actually proves that.
//
// What these defend: `HttpRequest` naming ONE declaration across both published
// entries. `HttpRequestSchema` was never duplicated — `./ui` imports and
// re-exports `./shared`'s const — so the only thing that ever split was the type
// alias, which is exactly the part runtime cannot see. Hence two layers.
describe('[#4688] HttpRequest is single-source across ./shared and ./ui', () => {
  it('both entry points expose the very same schema declaration at runtime', async () => {
    const sharedEntry = await import('../shared/index');
    const uiEntry = await import('../ui/index');

    // Identity, not shape: `lazySchema` returns one Proxy per declaration site,
    // so two declarations could never be `toBe`-equal however alike they look.
    // A re-introduced local `HttpRequestSchema` in view.zod.ts fails here.
    expect(uiEntry.HttpRequestSchema).toBe(sharedEntry.HttpRequestSchema);
  });

  it('the shared declaration validates identically on both entries', async () => {
    const sharedEntry = await import('../shared/index');
    const uiEntry = await import('../ui/index');

    for (const [entry, schema] of [
      ['./shared', sharedEntry.HttpRequestSchema],
      ['./ui', uiEntry.HttpRequestSchema],
    ] as const) {
      expect(schema.parse({ url: '/api/data' }), `${entry} defaults method to GET`)
        .toEqual({ url: '/api/data', method: 'GET' });
      expect(() => schema.parse({}), `${entry} requires url`).toThrow();
    }
  });

  // The load-bearing one. `HttpRequest` is a TYPE — erased before any runtime
  // assertion can see it — so the two tests above would stay green if the
  // re-export were deleted or replaced by a second local `z.infer` alias, which
  // is the entire defect #4688 fixed. This resolves the export through its alias
  // chain to the ORIGINAL declaration: the same symbol-identity measurement
  // `check:dual-source-exports` makes, but over `src/` so it runs in `pnpm test`
  // without a build. It also pins that `./ui` still EXPORTS the name at all —
  // the compatibility promise this file's own `type HttpRequest` import rests on.
  it('both entry points resolve the TYPE to the one declaration in shared/http.zod.ts', () => {
    for (const sub of ['./shared', './ui'] as const) {
      expect(
        maybeOriginOf(sub, 'HttpRequest'),
        `${sub} must still export the name \`HttpRequest\``,
      ).toBeDefined();
    }

    // ONE declaration reached by two import paths. The identity is the
    // declaration itself — the baseline records `<file>#<declared name> (<kind>)`
    // after unwinding the alias chain, so this is the same symbol-identity
    // measurement the retired in-test `ts.createProgram` made, and no coarser
    // than the `<file>:<line>` pair it used to compare (#4796).
    expect(originOf('./ui', 'HttpRequest')).toBe(originOf('./shared', 'HttpRequest'));
    expect(originFileOf('./shared', 'HttpRequest')).toBe('src/shared/http.zod.ts');
  });
});

// ─── [#4691] `HttpMethod` is gone from ./ui — the LAST dual-source row ───────
//
// The sibling of the #4688 pin above, and deliberately NOT the same fix. There,
// `./shared` and `./ui` named two declarations of the *same* shape and the cure
// was a re-export. Here the two declarations are genuinely different types:
//
//   shared/http.zod.ts  `export const/type HttpMethod`  → 7 values (+HEAD/OPTIONS)
//   shared/http.zod.ts  `HttpMethodSubsetSchema`/`HttpMethodSubset` → 5 (UI subset)
//   ui/view.zod.ts      `export type HttpMethod` (removed) → the 5-value one
//
// So re-exporting `./shared`'s into `./ui` would have widened the UI type to 7
// while `HttpRequestSchema.method` still accepts only 5 — a type that lies about
// its own runtime. The name was removed from `./ui` instead.
//
// [#5832] The 5-value side was spelled `HttpMethodSchema`/`HttpMethodType` until
// #5832. That const still collided with the 7-value enum one layer down — after
// `schemaNameFromExportKey` strips the `Schema` suffix both published as
// `shared/HttpMethod`, and the subset overwrote the routing contract in
// `json-schema/`, in the bundled `$defs` and on the reference page. Renaming the
// trio to `HttpMethodSubsetSchema` / `HttpMethodSubset` / `<cat>/HttpMethodSubset`
// is what freed `shared/HttpMethod` to publish the 7 values it always declared;
// the assertions below are unchanged in substance, only in spelling.
//
// Same reasoning as #4688 on the mechanism: `HttpMethod` is a TYPE, erased
// before any runtime assertion can see it, and #4642 established that a
// compile-time pin in this package was a no-op until #5286 (`tsconfig.json` excluded
// `**/*.test.ts`; vitest never enables `typecheck`). The compiler-API test is
// therefore the load-bearing one; the runtime tests below it guard the value
// ranges the whole argument rests on.
describe('[#4691] `HttpMethod` is not exported from ./ui', () => {
  it('resolves the export surface: ./ui has no `HttpMethod`, ./shared and ./api share one', () => {
    // A sanity anchor: if this entry resolved to nothing, the absence
    // assertions below would prove nothing at all.
    const uiNames = exportNamesOf('./ui');
    expect(uiNames.length, './ui must export a non-trivial surface').toBeGreaterThan(50);

    // 1. The row this change removes: `./ui` no longer names `HttpMethod`.
    expect(uiNames).not.toContain('HttpMethod');

    // 2. …but it still offers the 5-value type under its own name, so the
    //    migration stays inside this entry point.
    expect(uiNames, '`HttpMethodType` was renamed at #5832').not.toContain('HttpMethodType');
    expect(maybeOriginOf('./ui', 'HttpMethodSubset'), './ui must export `HttpMethodSubset`').toBeDefined();
    expect(originFileOf('./ui', 'HttpMethodSubset')).toBe('src/shared/http.zod.ts');

    // 3. `./shared` and `./api` keep naming ONE declaration `HttpMethod` — the
    //    7-value one. This change must not have disturbed that side.
    for (const sub of ['./shared', './api'] as const) {
      expect(maybeOriginOf(sub, 'HttpMethod'), `${sub} must still export \`HttpMethod\``).toBeDefined();
    }
    expect(originOf('./api', 'HttpMethod')).toBe(originOf('./shared', 'HttpMethod'));
    expect(originFileOf('./shared', 'HttpMethod')).toBe('src/shared/http.zod.ts');
  });

  it('keeps the two value ranges distinct: 7 for `HttpMethod`, 5 for `HttpMethodSubsetSchema`', async () => {
    const sharedEntry = await import('../shared/index');
    const apiEntry = await import('../api/index');

    // `./api` re-exports the const, so this is one object seen twice.
    expect(apiEntry.HttpMethod).toBe(sharedEntry.HttpMethod);

    expect([...sharedEntry.HttpMethod.options].sort()).toEqual(
      ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    );
    expect([...sharedEntry.HttpMethodSubsetSchema.options].sort()).toEqual(
      ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'],
    );

    // The subset relation is the whole reason the two names cannot merge.
    expect(sharedEntry.HttpMethod.options).toContain('HEAD');
    expect(sharedEntry.HttpMethodSubsetSchema.options).not.toContain('HEAD');
  });

  it('rejects `HEAD` at the parse layer — the runtime the ./ui type must not out-promise', async () => {
    const uiEntry = await import('../ui/index');

    expect(() => uiEntry.HttpMethodSubsetSchema.parse('HEAD')).toThrow();
    expect(() => uiEntry.HttpMethodSubsetSchema.parse('OPTIONS')).toThrow();
    expect(() => uiEntry.HttpRequestSchema.parse({ url: '/api/data', method: 'HEAD' })).toThrow();
    // …while the 5 it does accept still round-trip, so the guard above is not
    // passing because the schema rejects everything.
    expect(uiEntry.HttpRequestSchema.parse({ url: '/api/data', method: 'PATCH' }).method)
      .toBe('PATCH');
  });
});

describe('ADR-0089 — visibleWhen unification (view form)', () => {
  it('normalizes a deprecated `visibleOn` alias to `visibleWhen` on a form field', () => {
    const parsed = FormFieldSchema.parse({ field: 'state', visibleOn: "record.country == 'US'" });
    expect(parsed.visibleWhen).toBeDefined();
    expect(parsed.visibleOn).toBeUndefined();
  });

  it('normalizes a deprecated `visibleOn` alias to `visibleWhen` on a form section', () => {
    const parsed = FormSectionSchema.parse({
      label: 'Shipping',
      visibleOn: "record.needs_shipping == true",
      fields: ['address'],
    });
    expect(parsed.visibleWhen).toBeDefined();
    expect((parsed as Record<string, unknown>).visibleOn).toBeUndefined();
  });

  it('keeps the canonical `visibleWhen` when both are present (canonical wins)', () => {
    const parsed = FormFieldSchema.parse({
      field: 'state',
      visibleWhen: "record.a == 1",
      visibleOn: "record.b == 2",
    });
    const src = typeof parsed.visibleWhen === 'string'
      ? parsed.visibleWhen
      : (parsed.visibleWhen as { source?: string }).source;
    expect(src).toBe('record.a == 1');
    expect(parsed.visibleOn).toBeUndefined();
  });
});

describe('ADR-0089 D3a — strict view form schemas (loud mis-layered keys)', () => {
  it('rejects an unknown key on a form field instead of silently stripping it', () => {
    const res = FormFieldSchema.safeParse({ field: 'state', notARealKey: 1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].code).toBe('unrecognized_keys');
    }
  });

  it('a visibility-ish typo is rejected AND the message points at `visibleWhen`', () => {
    const res = FormFieldSchema.safeParse({ field: 'state', visibleWhenn: "record.a == 1" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toContain('visibleWhen');
    }
  });

  it('the deprecated `visibleOn` alias is still accepted under strict (declared key)', () => {
    expect(() => FormFieldSchema.parse({ field: 'state', visibleOn: "record.a == 1" })).not.toThrow();
  });

  it('rejects a stale `visibility` key on a form field (that is the page-component alias, not a view one)', () => {
    const res = FormFieldSchema.safeParse({ field: 'state', visibility: "record.a == 1" });
    expect(res.success).toBe(false);
  });

  it('a non-visibility unknown key is rejected without the visibleWhen hint', () => {
    const res = FormSectionSchema.safeParse({ label: 'S', fields: [], bogusKey: true });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).not.toContain('visibleWhen');
      expect(res.error.issues[0].message).toContain('bogusKey');
    }
  });

  it('a strict form section still accepts canonical + alias keys', () => {
    expect(() => FormSectionSchema.parse({ label: 'S', visibleWhen: 'record.a == 1', fields: [] })).not.toThrow();
    expect(() => FormSectionSchema.parse({ label: 'S', visibleOn: 'record.a == 1', fields: [] })).not.toThrow();
  });
});

/**
 * Message ORDER on the ADR-0089 visibility rejection (#6416, applying #5955's
 * ruling; #6619 folded the map into the shared template).
 *
 * This block was written against `strictVisibilityError`, the hand-written
 * `$ZodErrorMap` that #5955 and #5593 could not reach; #6416 direction 1
 * reordered it in place, and these pins were that reorder's acceptance
 * criteria. #6619 then folded the map into `strictObject`'s set-keyed
 * `guidance` channel (`VISIBILITY_STRICT_OPTIONS`), and the pins migrated with
 * the code — the emission ORDER they encode (front matter → fix channels →
 * explanatory sentence last) is the template's own contract. One byte-level
 * change rode the fold and is pinned below as such: the prescription is now
 * rendered as the template's `\n  • ` bullet instead of joined inline with a
 * space, the same channel every other closed surface's prescriptions use.
 *
 * These are ORDER pins, not presence checks. The fold deletes nothing, so
 * every existing `toContain` in the block above stays green either way; a
 * future edit that folds the sentence back into the middle passes all of them
 * and fails here.
 */
describe('visibility unknown-key message order — fix before history (#6416 / #6619)', () => {
  const HISTORY =
    'Before ADR-0089 D3a these were dropped silently, shipping inert metadata; ' +
    'a mis-layered or stale key is now a loud parse error.';
  const PRESCRIPTION = 'the canonical key is `visibleWhen` (ADR-0089)';

  const messageFor = (body: Record<string, unknown>) => {
    const res = FormFieldSchema.safeParse({ field: 'state', ...body });
    expect(res.success).toBe(false);
    const unknown = res.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown).toBeDefined();
    return unknown!.message;
  };

  it('names the wrong key first, then the alias pointer, then the history', () => {
    const m = messageFor({ visibleWhenn: 'record.a == 1' });
    // 1. which key is wrong — and nothing before it
    expect(m.startsWith('Unrecognized key(s) on this view/page schema: `visibleWhenn`.')).toBe(true);
    // 2. the fix, immediately after it — this is the whole point of the reorder.
    //    Since #6619 the prescription arrives as the shared template's `  • `
    //    bullet (it rides the set-keyed guidance channel); the position is
    //    unchanged — directly after the key statement, before the history.
    expect(m).toContain('`visibleWhenn`.\n  • If this is the conditional-visibility predicate');
    // 3. the history sentence, verbatim, last — moved, never dropped
    expect(m).toContain(PRESCRIPTION);
    expect(m.indexOf(PRESCRIPTION)).toBeLessThan(m.indexOf(HISTORY));
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });

  it('still emits the whole alias table after the reorder — nothing was trimmed', () => {
    // The prescription names all three spellings; a reorder that quietly lost
    // one of them would still satisfy the order assertions above.
    const m = messageFor({ visibleWhenn: 'record.a == 1' });
    expect(m).toContain('`visibleOn` (view form)');
    expect(m).toContain('`visibility` (page component) are still accepted as deprecated aliases.');
  });

  it('is unchanged in SHAPE when there is no visibility hint to offer', () => {
    // No prescription branch — the sentence follows the key statement directly,
    // exactly as it always did. Full-message pin, so a stray separator or a
    // duplicated clause fails here.
    const res = FormSectionSchema.safeParse({ label: 'S', fields: [], bogusKey: true });
    expect(res.success).toBe(false);
    const m = res.error!.issues.find((i) => i.code === 'unrecognized_keys')!.message;
    expect(m).toBe(`Unrecognized key(s) on this view/page schema: \`bogusKey\`. ${HISTORY}`);
  });

  it('emits the history exactly once, whatever the key count', () => {
    // One `unrecognized_keys` issue names every offending key, so "last" is a
    // well-defined position: the sentence is appended to that one message once.
    const m = messageFor({ visibleWhenn: 'record.a == 1', alsoWrong: 2, andThis: 3 });
    expect(m.split(HISTORY)).toHaveLength(2);
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });
});

/**
 * ObjectUI Studio derives the View inspector's authoring JSONSchema from
 * ViewSchema via `z.toJSONSchema` (objectui#2561). FormFieldSchema is a
 * self-recursive `.strict().transform(…)` pipe reached through
 * `z.lazy(() => FormFieldSchema)` — the exact lazySchema-proxy identity shape
 * that crashed zod's converter before the `_zod` facade fix.
 */
describe('ViewSchema → JSON Schema derivation (Studio inspector path)', () => {
  const TO_JSON = { io: 'input', unrepresentable: 'any' } as const;

  it('derives the input-io JSONSchema for the whole View document', () => {
    expect(() => z.toJSONSchema(ViewSchema, TO_JSON)).not.toThrow();
  });

  it('derives the input-io JSONSchema for the recursive FormFieldSchema', () => {
    expect(() => z.toJSONSchema(FormFieldSchema, TO_JSON)).not.toThrow();
  });
});
