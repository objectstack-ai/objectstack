import { describe, it, expect } from 'vitest';
import {
  PageSchema,
  PageComponentSchema,
  PageRegionSchema,
  PageTypeSchema,
  RecordReviewConfigSchema,
  ElementDataSourceSchema,
  BlankPageLayoutSchema,
  PageVariableSchema,
  InterfacePageConfigSchema,
  type Page,
  type PageComponent,
  type PageRegion,
  type ElementDataSource,
  type RecordReviewConfig,
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
      visibility: 'record.type == "Customer"',
    });

    expect(component.id).toBe('related_contacts');
    expect(component.label).toBe('Related Contacts');
    expect(component.visibility).toBeDefined();
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

  it('should accept different page types', () => {
    const types: Array<Page['type']> = [
      'record', 'home', 'app', 'utility',
      'dashboard', 'grid', 'list', 'gallery', 'kanban', 'calendar',
      'timeline', 'form', 'record_detail', 'overview',
    ];

    types.forEach(type => {
      const page = PageSchema.parse({
        name: 'test_page',
        label: 'Test Page',
        type,
        regions: [],
      });
      expect(page.type).toBe(type);
    });

    // record_review requires recordReview config
    const reviewPage = PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
      type: 'record_review',
      regions: [],
      recordReview: {
        object: 'case',
        actions: [{ label: 'Approve', type: 'approve' }],
      },
    });
    expect(reviewPage.type).toBe('record_review');

    // blank requires blankLayout config
    const blankPage = PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
      type: 'blank',
      regions: [],
      blankLayout: { items: [] },
    });
    expect(blankPage.type).toBe('blank');
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

    expect(() => PageSchema.parse({
      name: 'test_page',
      label: 'Test Page',
    })).toThrow();
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

  it('should accept all interface page types', () => {
    const types = [
      'dashboard', 'grid', 'list', 'gallery', 'kanban', 'calendar',
      'timeline', 'form', 'record_detail', 'record_review', 'overview', 'blank',
    ];

    types.forEach(type => {
      expect(() => PageTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid page type', () => {
    expect(() => PageTypeSchema.parse('invalid')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecordReviewConfigSchema
// ---------------------------------------------------------------------------
describe('RecordReviewConfigSchema', () => {
  it('should accept minimal review config', () => {
    const config: RecordReviewConfig = RecordReviewConfigSchema.parse({
      object: 'order',
      actions: [
        { label: 'Approve', type: 'approve' },
      ],
    });

    expect(config.object).toBe('order');
    expect(config.actions).toHaveLength(1);
    expect(config.navigation).toBe('sequential');
    expect(config.showProgress).toBe(true);
  });

  it('should accept full review config', () => {
    const config = RecordReviewConfigSchema.parse({
      object: 'invoice',
      filter: { status: 'pending' },
      sort: [{ field: 'created_at', order: 'desc' }],
      displayFields: ['amount', 'vendor', 'description'],
      actions: [
        { label: 'Approve', type: 'approve', field: 'status', value: 'approved', nextRecord: true },
        { label: 'Reject', type: 'reject', field: 'status', value: 'rejected' },
        { label: 'Skip', type: 'skip', nextRecord: true },
        { label: 'Flag', type: 'custom', field: 'flagged', value: true },
      ],
      navigation: 'filtered',
      showProgress: false,
    });

    expect(config.actions).toHaveLength(4);
    expect(config.navigation).toBe('filtered');
    expect(config.showProgress).toBe(false);
    expect(config.displayFields).toEqual(['amount', 'vendor', 'description']);
  });

  it('should reject review config without object', () => {
    expect(() => RecordReviewConfigSchema.parse({
      actions: [{ label: 'Approve', type: 'approve' }],
    })).toThrow();
  });

  it('should reject review config without actions', () => {
    expect(() => RecordReviewConfigSchema.parse({
      object: 'order',
    })).toThrow();
  });

  it('should accept all action types', () => {
    const types = ['approve', 'reject', 'skip', 'custom'] as const;

    types.forEach(type => {
      expect(() => RecordReviewConfigSchema.parse({
        object: 'order',
        actions: [{ label: 'Action', type }],
      })).not.toThrow();
    });
  });

  it('should accept all navigation modes', () => {
    const modes = ['sequential', 'random', 'filtered'] as const;

    modes.forEach(navigation => {
      const config = RecordReviewConfigSchema.parse({
        object: 'order',
        actions: [{ label: 'Ok', type: 'approve' }],
        navigation,
      });
      expect(config.navigation).toBe(navigation);
    });
  });
});

// ---------------------------------------------------------------------------
// PageSchema with page types
// ---------------------------------------------------------------------------
describe('PageSchema with page types', () => {
  it('should accept minimal interface-style page', () => {
    const page: Page = PageSchema.parse({
      name: 'page_overview',
      label: 'Overview',
      type: 'blank',
      blankLayout: { items: [] },
      regions: [],
    });

    expect(page.name).toBe('page_overview');
    expect(page.type).toBe('blank');
    expect(page.template).toBe('default');
  });

  it('should accept dashboard page', () => {
    const page = PageSchema.parse({
      name: 'page_dashboard',
      label: 'Dashboard',
      type: 'dashboard',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'element:number', properties: { object: 'order', aggregate: 'count' } },
          ],
        },
      ],
    });

    expect(page.type).toBe('dashboard');
    expect(page.regions[0].components).toHaveLength(1);
  });

  it('should accept record_review page with config', () => {
    const page = PageSchema.parse({
      name: 'page_review',
      label: 'Review Queue',
      type: 'record_review',
      object: 'order',
      recordReview: {
        object: 'order',
        actions: [
          { label: 'Approve', type: 'approve', field: 'status', value: 'approved' },
          { label: 'Reject', type: 'reject', field: 'status', value: 'rejected' },
        ],
      },
      regions: [],
    });

    expect(page.type).toBe('record_review');
    expect(page.recordReview?.actions).toHaveLength(2);
  });

  it('should accept page with variables', () => {
    const page = PageSchema.parse({
      name: 'page_filtered',
      label: 'Filtered View',
      type: 'blank',
      blankLayout: { items: [] },
      variables: [
        { name: 'selectedId', type: 'string' },
        { name: 'showArchived', type: 'boolean', defaultValue: false },
      ],
      regions: [],
    });

    expect(page.variables).toHaveLength(2);
  });

  it('should accept all interface page types', () => {
    const basicTypes = [
      'dashboard', 'grid', 'list', 'gallery', 'kanban', 'calendar',
      'timeline', 'form', 'record_detail', 'overview',
    ];

    basicTypes.forEach(type => {
      expect(() => PageSchema.parse({
        name: 'test_page',
        label: 'Test',
        type,
        regions: [],
      })).not.toThrow();
    });

    // record_review requires recordReview config
    expect(() => PageSchema.parse({
      name: 'test_page',
      label: 'Test',
      type: 'record_review',
      regions: [],
      recordReview: {
        object: 'case',
        actions: [{ label: 'Approve', type: 'approve' }],
      },
    })).not.toThrow();

    // blank requires blankLayout config
    expect(() => PageSchema.parse({
      name: 'test_page',
      label: 'Test',
      type: 'blank',
      regions: [],
      blankLayout: { items: [] },
    })).not.toThrow();
  });

  it('should accept page with icon', () => {
    const page = PageSchema.parse({
      name: 'page_with_icon',
      label: 'Dashboard',
      type: 'dashboard',
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
// BlankPageLayoutSchema — free-form canvas composition
// ---------------------------------------------------------------------------
describe('BlankPageLayoutSchema', () => {
  it('should accept minimal layout with defaults', () => {
    const layout = BlankPageLayoutSchema.parse({
      items: [],
    });
    expect(layout.columns).toBe(12);
    expect(layout.rowHeight).toBe(40);
    expect(layout.gap).toBe(8);
    expect(layout.items).toHaveLength(0);
  });

  it('should accept full layout config', () => {
    const layout = BlankPageLayoutSchema.parse({
      columns: 24,
      rowHeight: 20,
      gap: 4,
      items: [
        { componentId: 'text_1', x: 0, y: 0, width: 12, height: 2 },
        { componentId: 'btn_1', x: 0, y: 2, width: 6, height: 1 },
        { componentId: 'picker_1', x: 6, y: 2, width: 6, height: 3 },
      ],
    });
    expect(layout.columns).toBe(24);
    expect(layout.items).toHaveLength(3);
    expect(layout.items[0].x).toBe(0);
    expect(layout.items[2].width).toBe(6);
  });

  it('should reject item with invalid dimensions', () => {
    expect(() => BlankPageLayoutSchema.parse({
      items: [{ componentId: 'a', x: 0, y: 0, width: 0, height: 1 }],
    })).toThrow();

    expect(() => BlankPageLayoutSchema.parse({
      items: [{ componentId: 'a', x: -1, y: 0, width: 1, height: 1 }],
    })).toThrow();
  });

  it('should accept page with blankLayout', () => {
    const page = PageSchema.parse({
      name: 'blank_canvas',
      label: 'Canvas',
      type: 'blank',
      regions: [
        {
          name: 'main',
          components: [
            { id: 'text_1', type: 'element:text', properties: { content: 'Hello' } },
            { id: 'btn_1', type: 'element:button', properties: { label: 'Click' } },
          ],
        },
      ],
      blankLayout: {
        columns: 12,
        items: [
          { componentId: 'text_1', x: 0, y: 0, width: 12, height: 2 },
          { componentId: 'btn_1', x: 0, y: 2, width: 4, height: 1 },
        ],
      },
    });

    expect(page.blankLayout?.items).toHaveLength(2);
    expect(page.blankLayout?.columns).toBe(12);
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
      type: 'blank',
      blankLayout: { items: [] },
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
              properties: {
                object: 'account',
                displayField: 'name',
                targetVariable: 'selected_id',
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
      type: 'dashboard',
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

  it('should accept a record_review page with full config', () => {
    const page = PageSchema.parse({
      name: 'page_review',
      label: 'Review Queue',
      type: 'record_review',
      object: 'order',
      recordReview: {
        object: 'order',
        filter: { status: 'pending_review' },
        sort: [{ field: 'priority', order: 'desc' }],
        displayFields: ['customer_name', 'total', 'items_count'],
        actions: [
          { label: 'Approve', type: 'approve', field: 'status', value: 'approved' },
          { label: 'Reject', type: 'reject', field: 'status', value: 'rejected' },
          { label: 'Skip', type: 'skip' },
        ],
        navigation: 'sequential',
        showProgress: true,
      },
      regions: [],
    });

    expect(page.recordReview?.actions).toHaveLength(3);
  });

  it('should accept a grid page bound to an object', () => {
    const page = PageSchema.parse({
      name: 'page_grid',
      label: 'All Orders',
      type: 'grid',
      object: 'order',
      regions: [],
    });

    expect(page.type).toBe('grid');
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
      type: 'dashboard',
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

  it('should reject page without regions', () => {
    expect(() => PageSchema.parse({
      name: 'no_regions',
      label: 'No Regions',
    })).toThrow();
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

  it('should reject component without properties', () => {
    expect(() => PageComponentSchema.parse({
      type: 'record:details',
    })).toThrow();
  });
});

describe('RecordReviewConfigSchema - Negative Validation', () => {
  it('should reject review config without object', () => {
    expect(() => RecordReviewConfigSchema.parse({
      actions: [{ label: 'Approve', type: 'approve' }],
    })).toThrow();
  });

  it('should reject review config without actions', () => {
    expect(() => RecordReviewConfigSchema.parse({
      object: 'lead',
    })).toThrow();
  });

  it('should reject review action with invalid type enum', () => {
    expect(() => RecordReviewConfigSchema.parse({
      object: 'lead',
      actions: [{ label: 'Bad', type: 'invalid_action' }],
    })).toThrow();
  });
});

// ============================================================================
// Issue #5: PageSchema conditional validation (superRefine)
// ============================================================================
describe('PageSchema - conditional validation', () => {
  it('should reject record_review page without recordReview config', () => {
    expect(() => PageSchema.parse({
      name: 'review_page',
      label: 'Review',
      type: 'record_review',
      regions: [],
    })).toThrow();
  });

  it('should accept record_review page with recordReview config', () => {
    expect(() => PageSchema.parse({
      name: 'review_page',
      label: 'Review',
      type: 'record_review',
      regions: [],
      recordReview: {
        object: 'order',
        actions: [{ label: 'Approve', type: 'approve' }],
      },
    })).not.toThrow();
  });

  it('should reject blank page without blankLayout config', () => {
    expect(() => PageSchema.parse({
      name: 'blank_page',
      label: 'Blank',
      type: 'blank',
      regions: [],
    })).toThrow();
  });

  it('should accept blank page with blankLayout config', () => {
    expect(() => PageSchema.parse({
      name: 'blank_page',
      label: 'Blank',
      type: 'blank',
      regions: [],
      blankLayout: { items: [] },
    })).not.toThrow();
  });

  it('should not require recordReview for non-record_review types', () => {
    expect(() => PageSchema.parse({
      name: 'grid_page',
      label: 'Grid',
      type: 'grid',
      regions: [],
    })).not.toThrow();
  });

  it('should not require blankLayout for non-blank types', () => {
    expect(() => PageSchema.parse({
      name: 'dashboard_page',
      label: 'Dashboard',
      type: 'dashboard',
      regions: [],
    })).not.toThrow();
  });
});
