import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  PageSchema,
  PAGE_TYPE_ROADMAP,
  PageComponentSchema,
  PageRegionSchema,
  PageTypeSchema,
  ElementDataSourceSchema,
  PageVariableSchema,
  InterfacePageConfigSchema,
  type Page,
  type PageComponent,
  type PageRegion,
  type ElementDataSource,
  type InterfacePageConfig,
} from './page.zod';

describe('PageComponentSchema', () => {
  it('should accept valid minimal component', () => {
    const component: PageComponent = {
      type: 'steedos-labs.related-list',
      properties: {},
    };

    expect(() => PageComponentSchema.parse(component)).not.toThrow();
  });

  it('should accept component with all fields', () => {
    const component = PageComponentSchema.parse({
      type: 'steedos-labs.related-list',
      id: 'related_contacts',
      label: 'Related Contacts',
      properties: {
        objectName: 'contact',
        filterField: 'account_id',
        columns: ['name', 'email', 'phone'],
      },
      visibleWhen: 'record.type == "Customer"',
    });

    expect(component.id).toBe('related_contacts');
    expect(component.label).toBe('Related Contacts');
    expect(component.visibleWhen).toBeDefined();
  });

  it('should accept component with complex properties', () => {
    const component = PageComponentSchema.parse({
      type: 'custom.dashboard-widget',
      properties: {
        title: 'Sales Pipeline',
        chartType: 'funnel',
        dataSource: 'opportunity',
        filters: { stage: { $ne: 'Closed Lost' } },
        groupBy: 'stage',
        aggregate: 'sum',
        field: 'amount',
      },
    });

    expect(component.properties.title).toBe('Sales Pipeline');
  });
});

describe('PageRegionSchema', () => {
  it('should accept valid minimal region', () => {
    const region: PageRegion = {
      name: 'main',
      components: [],
    };

    expect(() => PageRegionSchema.parse(region)).not.toThrow();
  });

  it('should accept region with all fields', () => {
    const region = PageRegionSchema.parse({
      name: 'sidebar',
      width: 'small',
      components: [
        {
          type: 'steedos-labs.quick-actions',
          properties: { actions: ['edit', 'delete'] },
        },
      ],
    });

    expect(region.name).toBe('sidebar');
    expect(region.width).toBe('small');
    expect(region.components).toHaveLength(1);
  });

  it('should accept different region widths', () => {
    const widths: Array<NonNullable<PageRegion['width']>> = ['small', 'medium', 'large', 'full'];

    widths.forEach(width => {
      const region = PageRegionSchema.parse({
        name: 'test',
        width,
        components: [],
      });
      expect(region.width).toBe(width);
    });
  });

  it('should accept region with multiple components', () => {
    const region = PageRegionSchema.parse({
      name: 'main',
      components: [
        { type: 'component.header', properties: {} },
        { type: 'component.body', properties: {} },
        { type: 'component.footer', properties: {} },
      ],
    });

    expect(region.components).toHaveLength(3);
  });
});

describe('PageSchema', () => {
  it('should accept valid minimal page', () => {
    const page: Page = {
      name: 'account_record_page',
      label: 'Account Record Page',
      regions: [],
    };

    expect(() => PageSchema.parse(page)).not.toThrow();
  });

  it('should validate page name format (snake_case)', () => {
    expect(() => PageSchema.parse({
      name: 'valid_page_name',
      label: 'Valid Page',
      regions: [],
    })).not.toThrow();

    expect(() => PageSchema.parse({
      name: 'InvalidPage',
      label: 'Invalid',
      regions: [],
    })).toThrow();

    expect(() => PageSchema.parse({
      name: 'invalid-page',
      label: 'Invalid',
      regions: [],
    })).toThrow();
  });

  it('should apply default values', () => {
    const page = PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
      regions: [],
    });

    expect(page.type).toBe('record');
    expect(page.template).toBe('default');
    expect(page.isDefault).toBe(false);
  });

  it('should accept page with all fields', () => {
    const page = PageSchema.parse({
      name: 'account_record_page',
      label: 'Account Record Page',
      description: 'Custom record page for accounts',
      type: 'record',
      object: 'account',
      template: 'header-sidebar-main',
      regions: [
        {
          name: 'header',
          components: [
            { type: 'record.header', properties: {} },
          ],
        },
        {
          name: 'sidebar',
          width: 'small',
          components: [
            { type: 'record.details', properties: {} },
          ],
        },
        {
          name: 'main',
          width: 'large',
          components: [
            { type: 'related.list', properties: { objectName: 'contact' } },
          ],
        },
      ],
      isDefault: true,
      assignedProfiles: ['admin', 'sales_user'],
    });

    expect(page.object).toBe('account');
    expect(page.regions).toHaveLength(3);
    expect(page.isDefault).toBe(true);
  });

  it('should accept the live page types', () => {
    const types: Array<Page['type']> = ['record', 'home', 'app', 'utility', 'list'];
    types.forEach(type => {
      const page = PageSchema.parse({
        name: 'test_page',
        label: 'Test Page',
        type,
        regions: [],
      });
      expect(page.type).toBe(type);
    });
  });

  it('should reject roadmap page types that have no renderer (enforce-or-remove)', () => {
    // dashboard / form / record_detail / record_review / overview / blank were
    // removed from PageTypeSchema — authoring one used to pass validation then
    // break at runtime ("Unknown component type"). The enum is now the live set.
    for (const type of PAGE_TYPE_ROADMAP) {
      expect(
        () => PageSchema.parse({ name: 'test_page', label: 'Test Page', type, regions: [] }),
        `roadmap type "${type}" must be rejected until it ships a renderer`,
      ).toThrow();
    }
  });

  it('should accept record page', () => {
    const page = PageSchema.parse({
      name: 'opportunity_page',
      label: 'Opportunity Page',
      type: 'record',
      object: 'opportunity',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'record.form', properties: {} },
          ],
        },
      ],
    });

    expect(page.type).toBe('record');
    expect(page.object).toBe('opportunity');
  });

  it('should accept home page', () => {
    const page = PageSchema.parse({
      name: 'sales_home',
      label: 'Sales Home',
      type: 'home',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'dashboard.widget', properties: { dashboardId: 'sales_dashboard' } },
          ],
        },
      ],
    });

    expect(page.type).toBe('home');
  });

  it('should accept app page', () => {
    const page = PageSchema.parse({
      name: 'sales_app',
      label: 'Sales App',
      type: 'app',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'app.navigation', properties: {} },
          ],
        },
      ],
    });

    expect(page.type).toBe('app');
  });

  it('should accept utility page', () => {
    const page = PageSchema.parse({
      name: 'notes_utility',
      label: 'Notes Utility',
      type: 'utility',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'utility.notes', properties: {} },
          ],
        },
      ],
    });

    expect(page.type).toBe('utility');
  });

  it('should accept page with profile assignments', () => {
    const page = PageSchema.parse({
      name: 'custom_page',
      label: 'Custom Page',
      regions: [],
      assignedProfiles: ['admin', 'sales_manager', 'sales_rep'],
    });

    expect(page.assignedProfiles).toHaveLength(3);
  });

  it('should accept page with custom template', () => {
    const page = PageSchema.parse({
      name: 'custom_layout_page',
      label: 'Custom Layout Page',
      template: 'three-column-layout',
      regions: [],
    });

    expect(page.template).toBe('three-column-layout');
  });

  it('should accept default page', () => {
    const page = PageSchema.parse({
      name: 'default_page',
      label: 'Default Page',
      isDefault: true,
      regions: [],
    });

    expect(page.isDefault).toBe(true);
  });

  it('should accept page with multiple regions', () => {
    const page = PageSchema.parse({
      name: 'multi_region_page',
      label: 'Multi Region Page',
      regions: [
        { name: 'header', components: [] },
        { name: 'sidebar', width: 'small', components: [] },
        { name: 'main', width: 'large', components: [] },
        { name: 'footer', components: [] },
      ],
    });

    expect(page.regions).toHaveLength(4);
  });

  it('should accept page with nested component properties', () => {
    const page = PageSchema.parse({
      name: 'complex_page',
      label: 'Complex Page',
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'custom.widget',
              id: 'widget_1',
              properties: {
                config: {
                  nested: {
                    deeply: {
                      value: 'test',
                    },
                  },
                },
                array: [1, 2, 3],
                bool: true,
              },
            },
          ],
        },
      ],
    });

    expect(page.regions[0].components[0].properties.config).toBeDefined();
  });

  it('should reject page without required fields', () => {
    expect(() => PageSchema.parse({
      label: 'Test Page',
      regions: [],
    })).toThrow();

    expect(() => PageSchema.parse({
      name: 'test_page',
      regions: [],
    })).toThrow();

    // `regions` is intentionally NOT among the required fields — name + label
    // alone is a valid page (regions defaults to [], type defaults to 'record').
    // See the dedicated "accept page without regions" test below.
  });

  it('should reject invalid page type', () => {
    expect(() => PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
      type: 'invalid',
      regions: [],
    })).toThrow();
  });
});

describe('Page I18n Integration', () => {
  it('should reject i18n object as page label', () => {
    expect(() => PageSchema.parse({
      name: 'i18n_page',
      label: { key: 'pages.dashboard', defaultValue: 'Dashboard' },
      regions: [],
    })).toThrow();
  });
  it('should reject i18n as page description', () => {
    expect(() => PageSchema.parse({
      name: 'desc_page',
      label: 'Test',
      description: { key: 'pages.test.desc', defaultValue: 'A test page' },
      regions: [],
    })).toThrow();
  });
  it('should reject i18n as component label', () => {
    expect(() => PageComponentSchema.parse({
      type: 'page:header',
      label: { key: 'components.header', defaultValue: 'Header' },
      properties: {},
    })).toThrow();
  });
});

describe('Page ARIA Integration', () => {
  it('should accept page with ARIA attributes', () => {
    expect(() => PageSchema.parse({
      name: 'accessible_page',
      label: 'Accessible Page',
      regions: [],
      aria: { ariaLabel: 'Main application page', role: 'main' },
    })).not.toThrow();
  });
  it('should accept component with ARIA attributes', () => {
    expect(() => PageComponentSchema.parse({
      type: 'nav:menu',
      properties: {},
      aria: { ariaLabel: 'Main navigation', role: 'navigation' },
    })).not.toThrow();
  });
});

describe('Page Responsive Integration', () => {
  it('should accept component with responsive config', () => {
    const result = PageComponentSchema.parse({
      type: 'page:sidebar',
      properties: {},
      responsive: { hiddenOn: ['xs', 'sm'] },
    });
    expect(result.responsive?.hiddenOn).toEqual(['xs', 'sm']);
  });
});

// ---------------------------------------------------------------------------
// PageTypeSchema — unified page types (platform + interface)
// ---------------------------------------------------------------------------
describe('PageTypeSchema', () => {
  it('should accept all platform page types', () => {
    const types = ['record', 'home', 'app', 'utility'];
    types.forEach(type => {
      expect(() => PageTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept the live interface page type and reject roadmap ones', () => {
    // `list` is the only live interface page type. The rest were declared for
    // "roadmap parity" but never rendered — removed from PageTypeSchema
    // (enforce-or-remove, tracked in PAGE_TYPE_ROADMAP).
    expect(() => PageTypeSchema.parse('list')).not.toThrow();
    PAGE_TYPE_ROADMAP.forEach(type => {
      expect(() => PageTypeSchema.parse(type), `roadmap type "${type}"`).toThrow();
    });
  });

  it('should reject visualizations as page types (they belong in interfaceConfig.appearance.allowedVisualizations)', () => {
    // grid/kanban/calendar/gallery/timeline are visualizations of a `list`
    // page, not page kinds — they were removed from PageTypeSchema.
    ['grid', 'kanban', 'calendar', 'gallery', 'timeline'].forEach(type => {
      expect(() => PageTypeSchema.parse(type)).toThrow();
    });
  });

  it('should reject invalid page type', () => {
    expect(() => PageTypeSchema.parse('invalid')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PageSchema with page types
// ---------------------------------------------------------------------------
describe('PageSchema with page types', () => {
  it('should accept a minimal live page', () => {
    const page: Page = PageSchema.parse({
      name: 'page_overview',
      label: 'Overview',
      type: 'home',
      regions: [],
    });

    expect(page.name).toBe('page_overview');
    expect(page.type).toBe('home');
    expect(page.template).toBe('default');
  });

  it('should accept an app page with components', () => {
    const page = PageSchema.parse({
      name: 'page_dashboard',
      label: 'Dashboard',
      type: 'app',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'element:number', properties: { object: 'order', aggregate: 'count' } },
          ],
        },
      ],
    });

    expect(page.type).toBe('app');
    expect(page.regions[0].components).toHaveLength(1);
  });

  it('should accept page with variables', () => {
    const page = PageSchema.parse({
      name: 'page_filtered',
      label: 'Filtered View',
      type: 'home',
      variables: [
        { name: 'selectedId', type: 'string' },
        { name: 'showArchived', type: 'boolean', defaultValue: false },
      ],
      regions: [],
    });

    expect(page.variables).toHaveLength(2);
  });

  it('should accept page with icon', () => {
    const page = PageSchema.parse({
      name: 'page_with_icon',
      label: 'Dashboard',
      type: 'home',
      icon: 'bar-chart',
      regions: [],
    });

    expect(page.icon).toBe('bar-chart');
  });

  it('should reject page with i18n label', () => {
    expect(() => PageSchema.parse({
      name: 'i18n_page',
      label: { key: 'pages.overview', defaultValue: 'Overview' },
      regions: [],
    })).toThrow();
  });

  it('should accept page with ARIA attributes', () => {
    expect(() => PageSchema.parse({
      name: 'accessible_page',
      label: 'Accessible Page',
      regions: [],
      aria: { ariaLabel: 'App overview page', role: 'main' },
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ElementDataSourceSchema (per-element data binding)
// ---------------------------------------------------------------------------
describe('ElementDataSourceSchema', () => {
  it('should accept minimal data source', () => {
    const ds: ElementDataSource = ElementDataSourceSchema.parse({
      object: 'order',
    });

    expect(ds.object).toBe('order');
    expect(ds.view).toBeUndefined();
    expect(ds.filter).toBeUndefined();
    expect(ds.sort).toBeUndefined();
    expect(ds.limit).toBeUndefined();
  });

  it('should accept full data source', () => {
    const ds = ElementDataSourceSchema.parse({
      object: 'invoice',
      view: 'pending_review',
      filter: { status: 'pending' },
      sort: [{ field: 'created_at', order: 'desc' }],
      limit: 50,
    });

    expect(ds.object).toBe('invoice');
    expect(ds.view).toBe('pending_review');
    expect(ds.sort).toHaveLength(1);
    expect(ds.limit).toBe(50);
  });

  it('should reject without object', () => {
    expect(() => ElementDataSourceSchema.parse({})).toThrow();
  });

  it('should reject invalid sort order', () => {
    expect(() => ElementDataSourceSchema.parse({
      object: 'order',
      sort: [{ field: 'name', order: 'invalid' }],
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PageComponent dataSource integration
// ---------------------------------------------------------------------------
describe('PageComponent dataSource integration', () => {
  it('should accept component with dataSource', () => {
    const component = PageComponentSchema.parse({
      type: 'element:number',
      properties: { object: 'order', aggregate: 'sum', field: 'total' },
      dataSource: {
        object: 'order',
        filter: { status: 'completed' },
        limit: 100,
      },
    });

    expect(component.dataSource?.object).toBe('order');
    expect(component.dataSource?.limit).toBe(100);
  });

  it('should accept component without dataSource', () => {
    const component = PageComponentSchema.parse({
      type: 'element:text',
      properties: { content: 'Static text' },
    });

    expect(component.dataSource).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PageVariableSchema — record_picker variable binding
// ---------------------------------------------------------------------------
describe('PageVariableSchema record_id type', () => {
  it('should accept record_id variable type', () => {
    const variable = PageVariableSchema.parse({
      name: 'selected_account_id',
      type: 'record_id',
    });
    expect(variable.type).toBe('record_id');
  });

  it('should accept variable with source binding', () => {
    const variable = PageVariableSchema.parse({
      name: 'selected_account',
      type: 'record_id',
      source: 'picker_1',
    });
    expect(variable.source).toBe('picker_1');
  });

  it('should accept page with record_picker variable binding', () => {
    const page = PageSchema.parse({
      name: 'blank_picker',
      label: 'Picker Page',
      type: 'home',
      variables: [
        { name: 'selected_id', type: 'record_id', source: 'account_picker' },
        { name: 'show_details', type: 'boolean', defaultValue: false },
      ],
      regions: [
        {
          name: 'main',
          components: [
            {
              id: 'account_picker',
              type: 'element:record_picker',
              // The binding is carried by the VARIABLE's `source` above, not by
              // any picker prop — `displayField` (#5775) and `targetVariable`
              // (#9198) are both retired.
              properties: {
                object: 'account',
                labelField: 'name',
              },
            },
          ],
        },
      ],
    });

    expect(page.variables).toHaveLength(2);
    expect(page.variables![0].type).toBe('record_id');
    expect(page.variables![0].source).toBe('account_picker');
  });
});

// ---------------------------------------------------------------------------
// Page end-to-end
// ---------------------------------------------------------------------------
describe('Page end-to-end', () => {
  it('should accept a complete real-world page definition', () => {
    const page = PageSchema.parse({
      name: 'page_overview',
      label: 'Overview',
      type: 'home',
      object: 'order',
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'element:text',
              properties: { content: '# Order Dashboard', variant: 'heading' },
            },
            {
              type: 'element:number',
              properties: { object: 'order', aggregate: 'count' },
              dataSource: { object: 'order', filter: { status: 'pending' } },
            },
            {
              type: 'element:number',
              properties: { object: 'order', aggregate: 'sum', field: 'total', format: 'currency', prefix: '$' },
              dataSource: { object: 'order', filter: { status: 'completed' } },
            },
            {
              type: 'element:divider',
              properties: {},
            },
            {
              type: 'element:image',
              properties: { src: '/images/banner.jpg', alt: 'Order management', fit: 'cover', height: 200 },
            },
          ],
        },
      ],
    });

    expect(page.name).toBe('page_overview');
    expect(page.regions[0].components).toHaveLength(5);
  });

  it('should accept a list page bound to an object', () => {
    // A grid is a *visualization* of a list page, not a page type — bind the
    // object on a `list` page and pick the grid visualization via interfaceConfig.
    const page = PageSchema.parse({
      name: 'page_grid',
      label: 'All Orders',
      type: 'list',
      object: 'order',
      regions: [],
    });

    expect(page.type).toBe('list');
    expect(page.object).toBe('order');
  });
});

// ---------------------------------------------------------------------------
// InterfacePageConfigSchema — Airtable Interface parity
// ---------------------------------------------------------------------------
describe('InterfacePageConfigSchema', () => {
  it('should accept empty config', () => {
    const config: InterfacePageConfig = InterfacePageConfigSchema.parse({});
    expect(config).toBeDefined();
  });

  it('should accept full interface page config', () => {
    const config = InterfacePageConfigSchema.parse({
      source: 'customers',
      levels: 1,
      filterBy: [{ field: 'status', operator: 'equals', value: 'active' }],
      appearance: {
        showDescription: true,
        allowedVisualizations: ['grid', 'gallery', 'kanban'],
      },
      userFilters: {
        element: 'tabs',
        tabs: [
          { name: 'my_customers', label: 'my customers', isDefault: true },
          { name: 'all_records', label: 'All records' },
        ],
      },
      userActions: {
        sort: true,
        search: true,
        filter: true,
        rowHeight: true,
        addRecordForm: false,
        buttons: [],
      },
      addRecord: {
        enabled: true,
        position: 'bottom',
        mode: 'inline',
      },
      showRecordCount: true,
      allowPrinting: true,
    });

    expect(config.source).toBe('customers');
    expect(config.levels).toBe(1);
    expect(config.appearance?.allowedVisualizations).toHaveLength(3);
    expect(config.userFilters?.tabs).toHaveLength(2);
    expect(config.userActions?.sort).toBe(true);
    expect(config.showRecordCount).toBe(true);
    expect(config.allowPrinting).toBe(true);
  });

  it('should accept config with only source and levels', () => {
    const config = InterfacePageConfigSchema.parse({
      source: 'orders',
      levels: 2,
    });
    expect(config.source).toBe('orders');
    expect(config.levels).toBe(2);
  });

  it('should reject levels < 1', () => {
    expect(() => InterfacePageConfigSchema.parse({
      levels: 0,
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PageSchema with interfaceConfig
// ---------------------------------------------------------------------------
describe('PageSchema with interfaceConfig', () => {
  it('should accept page with interfaceConfig', () => {
    const page = PageSchema.parse({
      name: 'customer_list_page',
      label: '客户列表页面',
      description: '浏览并筛选所有客户信息',
      type: 'list',
      object: 'customers',
      interfaceConfig: {
        source: 'customers',
        levels: 1,
        filterBy: [],
        appearance: {
          showDescription: true,
          allowedVisualizations: ['grid', 'gallery', 'kanban'],
        },
        userFilters: {
          element: 'tabs',
          tabs: [
            { name: 'my_customers', label: 'my customers', isDefault: true, pinned: true },
            { name: 'all_records', label: 'All records' },
          ],
        },
        userActions: {
          sort: true,
          search: true,
          filter: true,
          rowHeight: true,
          addRecordForm: false,
        },
        addRecord: {
          enabled: true,
          position: 'bottom',
          mode: 'inline',
        },
        showRecordCount: true,
        allowPrinting: true,
      },
      regions: [],
    });

    expect(page.interfaceConfig?.source).toBe('customers');
    expect(page.interfaceConfig?.appearance?.allowedVisualizations).toHaveLength(3);
    expect(page.interfaceConfig?.userActions?.sort).toBe(true);
    expect(page.interfaceConfig?.showRecordCount).toBe(true);
    expect(page.interfaceConfig?.allowPrinting).toBe(true);
  });

  it('should accept page without interfaceConfig (backward compatibility)', () => {
    const page = PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
      regions: [],
    });
    expect(page.interfaceConfig).toBeUndefined();
  });

  it('should accept dashboard page with interfaceConfig', () => {
    const page = PageSchema.parse({
      name: 'sales_dashboard',
      label: 'Sales Dashboard',
      type: 'home',
      interfaceConfig: {
        appearance: {
          showDescription: false,
        },
        allowPrinting: false,
      },
      regions: [],
    });
    expect(page.interfaceConfig?.appearance?.showDescription).toBe(false);
    expect(page.interfaceConfig?.allowPrinting).toBe(false);
  });
});

// ============================================================================
// Negative / Inverse Validation Tests
// ============================================================================

describe('PageSchema - Negative Validation', () => {
  it('should reject page without name', () => {
    expect(() => PageSchema.parse({
      label: 'No Name Page',
      regions: [],
    })).toThrow();
  });

  it('should reject page without label', () => {
    expect(() => PageSchema.parse({
      name: 'no_label',
      regions: [],
    })).toThrow();
  });

  it('should accept page without regions (defaults to [])', () => {
    // Optional with a [] default: list/interface pages render via
    // interfaceConfig, slotted record pages via slots, and an empty full
    // record/home/app page falls back to the synthesized default layout.
    // Requiring regions forced `regions: []` boilerplate everywhere and made
    // the Studio "New Page" form a dead-end for non-list pages.
    const page = PageSchema.parse({
      name: 'no_regions',
      label: 'No Regions',
    });
    expect(page.regions).toEqual([]);
  });

  it('should reject page with camelCase name', () => {
    expect(() => PageSchema.parse({
      name: 'myPage',
      label: 'CamelCase Name',
      regions: [],
    })).toThrow();
  });

  it('should reject page with invalid type enum', () => {
    expect(() => PageSchema.parse({
      name: 'bad_type',
      label: 'Bad Type',
      type: 'nonexistent_type',
      regions: [],
    })).toThrow();
  });
});

describe('PageComponentSchema - Negative Validation', () => {
  it('should reject component without type', () => {
    expect(() => PageComponentSchema.parse({
      properties: {},
    })).toThrow();
  });

  it('should accept a component without properties (defaults to {})', () => {
    // `properties` is optional with a {} default: many components carry no
    // props (record:activity, element:divider) and the default-page
    // synthesizer emits prop-at-top-level nodes. Requiring it broke seeding a
    // record page's default layout in Studio (every block tripped
    // "components.N.properties: expected record").
    const comp = PageComponentSchema.parse({ type: 'record:details' });
    expect(comp.properties).toEqual({});
  });
});

// ============================================================================
// PageSchema cross-field requirements — none by design (enforce-or-remove)
// ============================================================================
describe('PageSchema - no cross-field requirements', () => {
  // The old superRefine required `recordReview`/`blankLayout` for the
  // record_review/blank types and `slots` for kind:'slotted'. All three are
  // gone: record_review/blank are unrendered roadmap types removed from the
  // enum (PAGE_TYPE_ROADMAP), and an empty slotted page validly renders the
  // synthesized default. Each was a "required-but-unauthorable field blocks the
  // Studio create form" trap.
  it('parses a minimal page of each live type with no extra config', () => {
    for (const type of ['record', 'home', 'app', 'utility', 'list'] as const) {
      expect(() => PageSchema.parse({ name: 'test_page', label: 'P', type, regions: [] })).not.toThrow();
    }
  });

  it('parses a slotted record page with no slots', () => {
    expect(() => PageSchema.parse({
      name: 'test_page', label: 'P', type: 'record', kind: 'slotted', regions: [],
    })).not.toThrow();
  });
});

describe('ADR-0089 — visibleWhen unification (page component)', () => {
  it('normalizes a deprecated `visibility` alias to `visibleWhen`', () => {
    const parsed = PageComponentSchema.parse({
      type: 'element:text',
      visibility: "page.selectedId != ''",
    });
    expect(parsed.visibleWhen).toBeDefined();
    expect((parsed as Record<string, unknown>).visibility).toBeUndefined();
  });

  it('keeps the canonical `visibleWhen` when both are present (canonical wins)', () => {
    const parsed = PageComponentSchema.parse({
      type: 'element:text',
      visibleWhen: "page.a == 1",
      visibility: "page.b == 2",
    });
    const src = typeof parsed.visibleWhen === 'string'
      ? parsed.visibleWhen
      : (parsed.visibleWhen as { source?: string }).source;
    expect(src).toBe('page.a == 1');
    expect((parsed as Record<string, unknown>).visibility).toBeUndefined();
  });
});

describe('ADR-0089 D3a — strict page component schema (loud mis-layered keys)', () => {
  it('rejects an unknown key on a page component instead of silently stripping it', () => {
    const res = PageComponentSchema.safeParse({ type: 'element:text', notARealKey: 1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].code).toBe('unrecognized_keys');
    }
  });

  it('a visibility-ish typo is rejected AND the message points at `visibleWhen`', () => {
    const res = PageComponentSchema.safeParse({ type: 'element:text', visibilty: "page.a == 1" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toContain('visibleWhen');
    }
  });

  it('the deprecated `visibility` alias is still accepted under strict (declared key)', () => {
    expect(() => PageComponentSchema.parse({ type: 'element:text', visibility: "page.a == 1" })).not.toThrow();
  });

  it('rejects a stale `visibleOn` key on a page component (that is the view-form alias, not a page one)', () => {
    const res = PageComponentSchema.safeParse({ type: 'element:text', visibleOn: "page.a == 1" });
    expect(res.success).toBe(false);
  });
});

/**
 * ObjectUI Studio derives the Page inspector's authoring JSONSchema straight
 * from these zod schemas via `z.toJSONSchema` (objectui#2561). The lazySchema
 * proxy must stay identity-compatible with zod's converter — the D3a
 * `.strict().transform(…)` pipe on PageComponentSchema is exactly the shape
 * that crashed it before the `_zod` facade fix.
 */
describe('PageSchema → JSON Schema derivation (Studio inspector path)', () => {
  const TO_JSON = { io: 'input', unrepresentable: 'any' } as const;

  it('derives the input-io JSONSchema for the whole Page document', () => {
    const json = z.toJSONSchema(PageSchema, TO_JSON);
    const text = JSON.stringify(json);
    expect(text).toContain('interfaceConfig');
    expect(text).toContain('regions');
  });

  it('derives the input-io JSONSchema for a bare PageComponent', () => {
    expect(() => z.toJSONSchema(PageComponentSchema, TO_JSON)).not.toThrow();
  });
});
