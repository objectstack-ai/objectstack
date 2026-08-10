import { describe, it, expect } from 'vitest';
import {
  AppSchema,
  AppBrandingSchema,
  NavigationContributionSchema,
  NavigationItemSchema,
  NavigationAreaSchema,
  ObjectNavItemSchema,
  DashboardNavItemSchema,
  PageNavItemSchema,
  UrlNavItemSchema,
  ReportNavItemSchema,
  ActionNavItemSchema,
  GroupNavItemSchema,
  defineApp,
  type App,
  type NavigationItem,
  type NavigationArea,
} from './app.zod';

describe('AppBrandingSchema', () => {
  it('should accept empty branding', () => {
    const branding = {};
    expect(() => AppBrandingSchema.parse(branding)).not.toThrow();
  });

  it('should accept full branding config', () => {
    const branding = {
      primaryColor: '#0070F3',
      logo: '/assets/logo.png',
      favicon: '/assets/favicon.ico',
    };

    expect(() => AppBrandingSchema.parse(branding)).not.toThrow();
  });
});

describe('ObjectNavItemSchema', () => {
  it('should accept minimal object nav item', () => {
    const navItem = {
      id: 'nav_accounts',
      label: 'Accounts',
      type: 'object' as const,
      objectName: 'account',
    };

    expect(() => ObjectNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept object nav item with all properties', () => {
    const navItem = {
      id: 'nav_active_tasks',
      label: 'Active Tasks',
      icon: 'check-square',
      type: 'object' as const,
      objectName: 'task',
      viewName: 'active',
      visible: 'user.has_permission("task.read")',
    };

    expect(() => ObjectNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept object nav item targeting a specific record', () => {
    const navItem = {
      id: 'nav_profile',
      label: 'My Profile',
      icon: 'user-circle',
      type: 'object' as const,
      objectName: 'sys_user',
      recordId: '{current_user_id}',
    };
    expect(() => ObjectNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept recordMode for record-targeted nav items', () => {
    const navItem = {
      id: 'nav_profile_edit',
      label: 'Edit Profile',
      type: 'object' as const,
      objectName: 'sys_user',
      recordId: '{current_user_id}',
      recordMode: 'edit' as const,
    };
    expect(() => ObjectNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept filters targeting the bare data surface (ADR-0055)', () => {
    const navItem = {
      id: 'nav_my_open',
      label: 'My Open Tickets',
      type: 'object' as const,
      objectName: 'ticket',
      filters: { owner_id: '{current_user_id}', status: 'open' },
    };
    expect(() => ObjectNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should reject non-string filter values', () => {
    const navItem = {
      id: 'nav_bad_filters',
      label: 'Bad',
      type: 'object' as const,
      objectName: 'ticket',
      filters: { status: 1 },
    };
    expect(() => ObjectNavItemSchema.parse(navItem)).toThrow();
  });

  // Deep-link auto-run (#4848) — the declared form of `?runAction=<name>`.
  it('should accept runAction composed with the list-surface landings', () => {
    const bare = {
      id: 'nav_envs',
      label: 'Environments',
      type: 'object' as const,
      objectName: 'sys_environment',
      runAction: 'create_environment',
    };
    expect(() => ObjectNavItemSchema.parse(bare)).not.toThrow();
    expect(() => ObjectNavItemSchema.parse({ ...bare, viewName: 'all' })).not.toThrow();
    expect(() => ObjectNavItemSchema.parse({ ...bare, filters: { status: 'active' } })).not.toThrow();
  });
});

describe('DashboardNavItemSchema', () => {
  it('should accept dashboard nav item', () => {
    const navItem = {
      id: 'nav_sales_dashboard',
      label: 'Sales Dashboard',
      icon: 'chart-bar',
      type: 'dashboard' as const,
      dashboardName: 'sales_overview',
    };

    expect(() => DashboardNavItemSchema.parse(navItem)).not.toThrow();
  });
});

describe('PageNavItemSchema', () => {
  it('should accept page nav item without params', () => {
    const navItem = {
      id: 'nav_settings',
      label: 'Settings',
      icon: 'settings',
      type: 'page' as const,
      pageName: 'user_settings',
    };

    expect(() => PageNavItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept page nav item with params', () => {
    const navItem = {
      id: 'nav_custom_page',
      label: 'Custom Page',
      type: 'page' as const,
      pageName: 'custom_component',
      params: {
        mode: 'advanced',
        theme: 'dark',
      },
    };

    expect(() => PageNavItemSchema.parse(navItem)).not.toThrow();
  });
});

describe('UrlNavItemSchema', () => {
  it('should accept URL nav item with default target', () => {
    const navItem = {
      id: 'nav_documentation',
      label: 'Documentation',
      type: 'url' as const,
      url: 'https://docs.example.com',
    };

    const result = UrlNavItemSchema.parse(navItem);
    expect(result.target).toBe('_self');
  });

  it('should accept URL nav item with blank target', () => {
    const navItem = {
      id: 'nav_external',
      label: 'External Link',
      icon: 'external-link',
      type: 'url' as const,
      url: 'https://example.com',
      target: '_blank' as const,
    };

    expect(() => UrlNavItemSchema.parse(navItem)).not.toThrow();
  });
});

describe('GroupNavItemSchema', () => {
  it('should accept group nav item', () => {
    const navItem = {
      id: 'nav_sales',
      label: 'Sales',
      icon: 'briefcase',
      type: 'group' as const,
    };

    const result = GroupNavItemSchema.parse(navItem);
    expect(result.expanded).toBe(false);
  });

  it('should accept group with expanded state', () => {
    const navItem = {
      id: 'nav_admin',
      label: 'Administration',
      type: 'group' as const,
      expanded: true,
    };

    const result = GroupNavItemSchema.parse(navItem);
    expect(result.expanded).toBe(true);
  });
});

describe('NavigationItemSchema (Recursive)', () => {
  it('should accept flat navigation items', () => {
    const items = [
      {
        id: 'nav_home',
        label: 'Home',
        type: 'dashboard' as const,
        dashboardName: 'home',
      },
      {
        id: 'nav_accounts',
        label: 'Accounts',
        type: 'object' as const,
        objectName: 'account',
      },
    ];

    items.forEach(item => {
      expect(() => NavigationItemSchema.parse(item)).not.toThrow();
    });
  });

  it('should accept nested navigation with groups', () => {
    const navItem = {
      id: 'nav_sales',
      label: 'Sales',
      icon: 'briefcase',
      type: 'group' as const,
      children: [
        {
          id: 'nav_accounts',
          label: 'Accounts',
          type: 'object' as const,
          objectName: 'account',
        },
        {
          id: 'nav_opportunities',
          label: 'Opportunities',
          type: 'object' as const,
          objectName: 'opportunity',
        },
      ],
    };

    expect(() => NavigationItemSchema.parse(navItem)).not.toThrow();
  });

  it('should accept deeply nested navigation', () => {
    const navItem = {
      id: 'nav_admin',
      label: 'Administration',
      type: 'group' as const,
      children: [
        {
          id: 'nav_users',
          label: 'Users & Permissions',
          type: 'group' as const,
          children: [
            {
              id: 'nav_users_list',
              label: 'Users',
              type: 'object' as const,
              objectName: 'user',
            },
            {
              id: 'nav_positions',
              label: 'Positions',
              type: 'object' as const,
              objectName: 'position',
            },
          ],
        },
      ],
    };

    expect(() => NavigationItemSchema.parse(navItem)).not.toThrow();
  });

  it('accepts a filters-only object item (bare data surface slice)', () => {
    const item = {
      id: 'nav_my_open',
      label: 'My Open',
      type: 'object' as const,
      objectName: 'ticket',
      filters: { owner_id: '{current_user_id}', status: 'open' },
    };
    expect(() => NavigationItemSchema.parse(item)).not.toThrow();
  });

  it('rejects filters combined with viewName (ambiguous landing)', () => {
    const item = {
      id: 'nav_bad',
      label: 'Bad',
      type: 'object' as const,
      objectName: 'ticket',
      viewName: 'by_status',
      filters: { status: 'open' },
    };
    expect(() => NavigationItemSchema.parse(item)).toThrow();
  });

  it('rejects filters combined with recordId (ambiguous landing)', () => {
    const item = {
      id: 'nav_bad2',
      label: 'Bad',
      type: 'object' as const,
      objectName: 'ticket',
      recordId: '{current_user_id}',
      filters: { status: 'open' },
    };
    expect(() => NavigationItemSchema.parse(item)).toThrow();
  });

  it('rejects runAction combined with recordId (no list surface to auto-run on, #4848)', () => {
    const item = {
      id: 'nav_bad3',
      label: 'Bad',
      type: 'object' as const,
      objectName: 'sys_environment',
      recordId: '{current_user_id}',
      runAction: 'create_environment',
    };
    expect(() => NavigationItemSchema.parse(item)).toThrow(/runAction.*cannot be combined with.*recordId/s);
  });

  it('tolerates the legacy recordId + viewName combination (documented: viewName ignored)', () => {
    const item = {
      id: 'nav_legacy',
      label: 'Legacy',
      type: 'object' as const,
      objectName: 'sys_user',
      recordId: '{current_user_id}',
      viewName: 'all',
    };
    expect(() => NavigationItemSchema.parse(item)).not.toThrow();
  });
});

describe('AppSchema', () => {
  it('should accept minimal app', () => {
    const app: App = {
      name: 'crm',
      label: 'CRM',
      navigation: [],
    };

    const result = AppSchema.parse(app);
    expect(result.active).toBe(true);
    expect(result.isDefault).toBe(false);
  });

  it('should enforce snake_case for app name', () => {
    const validNames = ['crm', 'sales_cloud', 'hr_portal'];
    validNames.forEach(name => {
      expect(() => AppSchema.parse({ name, label: 'Test', navigation: [] })).not.toThrow();
    });

    const invalidNames = ['CRM', 'sales-cloud', 'SalesCloud', '123app', '_internal'];
    invalidNames.forEach(name => {
      expect(() => AppSchema.parse({ name, label: 'Test', navigation: [] })).toThrow();
    });
  });

  it('should accept app with basic properties', () => {
    const app: App = {
      name: 'sales_app',
      label: 'Sales Application',
      description: 'Manage sales processes',
      icon: 'briefcase',
      active: true,
      isDefault: true,
      navigation: [],
    };

    expect(() => AppSchema.parse(app)).not.toThrow();
  });

  it('should accept app with branding', () => {
    const app: App = {
      name: 'custom_app',
      label: 'Custom App',
      branding: {
        primaryColor: '#FF6B6B',
        logo: '/custom-logo.svg',
        favicon: '/custom-favicon.ico',
      },
      navigation: [],
    };

    expect(() => AppSchema.parse(app)).not.toThrow();
  });

  it('should accept app with home page', () => {
    const app: App = {
      name: 'portal',
      label: 'Customer Portal',
      navigation: [
        {
          id: 'nav_dashboard',
          label: 'Dashboard',
          type: 'dashboard',
          dashboardName: 'customer_dashboard',
        },
      ],
    };

    expect(() => AppSchema.parse(app)).not.toThrow();
  });

  it('should accept app with required permissions', () => {
    const app: App = {
      name: 'admin_console',
      label: 'Admin Console',
      requiredPermissions: ['app.access.admin', 'system.admin'],
      navigation: [],
    };

    expect(() => AppSchema.parse(app)).not.toThrow();
  });

  describe('Real-World App Examples', () => {
    it('should accept CRM app with complex navigation', () => {
      const crmApp: App = {
        name: 'sales_crm',
        label: 'Sales CRM',
        description: 'Complete sales management solution',
        icon: 'chart-line',
        isDefault: true,
        branding: {
          primaryColor: '#0070F3',
        },
        navigation: [
          {
            id: 'nav_home',
            label: 'Home',
            icon: 'home',
            type: 'dashboard',
            dashboardName: 'sales_dashboard',
          },
          {
            id: 'nav_sales',
            label: 'Sales',
            icon: 'trending-up',
            type: 'group',
            expanded: true,
            children: [
              {
                id: 'nav_leads',
                label: 'Leads',
                icon: 'users',
                type: 'object',
                objectName: 'lead',
              },
              {
                id: 'nav_opportunities',
                label: 'Opportunities',
                icon: 'target',
                type: 'object',
                objectName: 'opportunity',
              },
              {
                id: 'nav_pipeline',
                label: 'Sales Pipeline',
                icon: 'chart-bar',
                type: 'dashboard',
                dashboardName: 'pipeline',
              },
            ],
          },
          {
            id: 'nav_customers',
            label: 'Customers',
            icon: 'building-2',
            type: 'group',
            children: [
              {
                id: 'nav_accounts',
                label: 'Accounts',
                type: 'object',
                objectName: 'account',
              },
              {
                id: 'nav_contacts',
                label: 'Contacts',
                type: 'object',
                objectName: 'contact',
              },
            ],
          },
          {
            id: 'nav_reports',
            label: 'Reports',
            icon: 'file-chart-line',
            type: 'page',
            pageName: 'reports_page',
          },
        ],
        requiredPermissions: ['app.access.crm'],
      };

      expect(() => AppSchema.parse(crmApp)).not.toThrow();
    });

    it('should accept HR portal app', () => {
      const hrApp: App = {
        name: 'hr_portal',
        label: 'HR Portal',
        description: 'Human resources management',
        icon: 'users-cog',
        branding: {
          primaryColor: '#10B981',
          logo: '/hr-logo.svg',
        },
        navigation: [
          {
            id: 'nav_my_info',
            label: 'My Information',
            icon: 'user',
            type: 'page',
            pageName: 'employee_profile',
          },
          {
            id: 'nav_time_off',
            label: 'Time Off',
            icon: 'calendar',
            type: 'object',
            objectName: 'time_off_request',
          },
          {
            id: 'nav_admin',
            label: 'Admin',
            icon: 'shield',
            type: 'group',
            visible: 'user.is_hr_admin',
            children: [
              {
                id: 'nav_employees',
                label: 'Employees',
                type: 'object',
                objectName: 'employee',
              },
              {
                id: 'nav_departments',
                label: 'Departments',
                type: 'object',
                objectName: 'department',
              },
            ],
          },
          {
            id: 'nav_help',
            label: 'Help Center',
            icon: 'help-circle',
            type: 'url',
            url: 'https://help.example.com',
            target: '_blank',
          },
        ],
        requiredPermissions: ['app.access.hr'],
      };

      expect(() => AppSchema.parse(hrApp)).not.toThrow();
    });

    it('rejects the retired app-level sharing/embed blocks with the per-form-view pointer', () => {
      // Pre-#4001 these parsed and were never read — a declared-but-unenforced
      // security surface (2026-06 liveness audit, ADR-0049). The tombstone
      // carries the prescription: public access is per FORM VIEW.
      const result = AppSchema.safeParse({
        name: 'shared_portal',
        label: 'Shared Portal',
        navigation: [],
        sharing: { enabled: true },
        embed: { enabled: true },
      });
      expect(result.success).toBe(false);
      const messages = result.error!.issues.map((i) => i.message).join('\n');
      expect(messages).toContain('FormView.sharing');
    });

    it('should accept CRM app with deeply nested navigation tree', () => {
      const crmApp = AppSchema.parse({
        name: 'crm',
        label: 'Sales CRM',
        icon: 'briefcase',
        branding: { primaryColor: '#4169E1' },
        navigation: [
          {
            id: 'grp_sales',
            type: 'group',
            label: 'Sales Cloud',
            icon: 'briefcase',
            expanded: true,
            children: [
              { id: 'nav_pipeline', type: 'page', label: 'Pipeline', icon: 'columns', pageName: 'page_pipeline' },
              { id: 'nav_accounts', type: 'page', label: 'Accounts', icon: 'building', pageName: 'page_accounts' },
              { id: 'nav_leads', type: 'page', label: 'Leads', icon: 'user-plus', pageName: 'page_leads' },
              {
                id: 'grp_review',
                type: 'group',
                label: 'Lead Review',
                icon: 'clipboard-check',
                expanded: false,
                children: [
                  { id: 'nav_review_queue', type: 'page', label: 'Review Queue', icon: 'check-square', pageName: 'page_review_queue' },
                  { id: 'nav_qualified', type: 'page', label: 'Qualified', icon: 'check-circle', pageName: 'page_qualified' },
                ],
              },
            ],
          },
          {
            id: 'grp_analytics',
            type: 'group',
            label: 'Analytics',
            icon: 'chart-line',
            expanded: false,
            children: [
              { id: 'nav_overview', type: 'page', label: 'Overview', icon: 'gauge', pageName: 'page_overview' },
              { id: 'nav_pipeline_report', type: 'page', label: 'Pipeline Report', icon: 'chart-bar', pageName: 'page_pipeline_report' },
            ],
          },
          { id: 'nav_settings', type: 'page', label: 'Settings', icon: 'settings', pageName: 'admin_settings' },
          { id: 'nav_help', type: 'url', label: 'Help', icon: 'help-circle', url: 'https://help.example.com', target: '_blank' },
        ],
        requiredPermissions: ['app.access.crm'],
      });

      expect(crmApp.navigation).toHaveLength(4);
      // Verify nested groups
      const salesGroup = crmApp.navigation![0];
      expect(salesGroup.type).toBe('group');
      expect(salesGroup.children).toHaveLength(4);
      // Verify deeply nested sub-group
      const reviewGroup = salesGroup.children[3];
      expect(reviewGroup.type).toBe('group');
      expect(reviewGroup.children).toHaveLength(2);
    });
  });
});

describe('App Mobile Navigation (retired, #4001)', () => {
  it('rejects the retired mobileNavigation block with the prescription', () => {
    // Pre-#4001 these tests asserted a mode picker that changed NOTHING — the
    // block was fully unimplemented (2026-06 liveness audit: even
    // packages/mobile ignored it). The strip-era fiction is a loud error now.
    const result = AppSchema.safeParse({
      name: 'mobile_app',
      label: 'Mobile App',
      mobileNavigation: { mode: 'bottom_nav' },
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('mobileNavigation');
    expect(messages).toContain('unimplemented');
  });
});

describe('defineApp', () => {
  it('should return a parsed app', () => {
    const result = defineApp({
      name: 'crm',
      label: 'CRM',
      navigation: [
        { id: 'nav_accounts', label: 'Accounts', type: 'object', objectName: 'account' },
      ],
    });
    expect(result.name).toBe('crm');
    expect(result.label).toBe('CRM');
    expect(result.navigation).toHaveLength(1);
  });

  it('should apply defaults', () => {
    const result = defineApp({
      name: 'my_app',
      label: 'My App',
    });
    expect(result.name).toBe('my_app');
  });

  it('should throw on invalid input', () => {
    expect(() => defineApp({
      name: 'INVALID NAME',
      label: 'Test',
    })).toThrow();
  });
});

describe('AppSchema retired sharing/embed keys (#4001)', () => {
  it('rejects app-level sharing with the FormView prescription', () => {
    const result = AppSchema.safeParse({
      name: 'public_app',
      label: 'Public App',
      sharing: { enabled: true },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join('\n')).toContain('FormView.sharing');
  });

  it('rejects app-level embed with the per-form-view prescription', () => {
    const result = AppSchema.safeParse({
      name: 'embeddable_app',
      label: 'Embeddable App',
      embed: { enabled: true },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join('\n')).toContain('iframe');
  });

  it('should accept app without sharing/embed (backward compatibility)', () => {
    const app = AppSchema.parse({
      name: 'basic_app',
      label: 'Basic App',
      navigation: [
        { id: 'nav_home', label: 'Home', type: 'object', objectName: 'account' },
      ],
    });

    expect(app.sharing).toBeUndefined();
    expect(app.embed).toBeUndefined();
    expect(app.navigation).toHaveLength(1);
  });
});

describe('BaseNavItem new fields (order, badge, requiredPermissions)', () => {
  it('should accept nav item with order', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_home',
      label: 'Home',
      type: 'dashboard',
      dashboardName: 'home',
      order: 1,
    });
    expect(item.order).toBe(1);
  });

  it('should accept nav item with string badge', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_inbox',
      label: 'Inbox',
      type: 'object',
      objectName: 'message',
      badge: 'New',
    });
    expect(item.badge).toBe('New');
  });

  it('should accept nav item with numeric badge', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_tasks',
      label: 'Tasks',
      type: 'object',
      objectName: 'task',
      badge: 5,
    });
    expect(item.badge).toBe(5);
  });

  it('should accept nav item with requiredPermissions', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_admin',
      label: 'Admin Panel',
      type: 'page',
      pageName: 'admin_panel',
      requiredPermissions: ['admin.access', 'system.manage'],
    });
    expect(item.requiredPermissions).toEqual(['admin.access', 'system.manage']);
  });

  it('should accept nav item with all new fields combined', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_reports',
      label: 'Reports',
      type: 'page',
      pageName: 'reports_page',
      order: 10,
      badge: 3,
      visible: 'user.is_admin',
      requiredPermissions: ['reports.view'],
    });
    expect(item.order).toBe(10);
    expect(item.badge).toBe(3);
    expect(item.requiredPermissions).toEqual(['reports.view']);
  });

  it('should still accept nav items without new fields (backward compatibility)', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_accounts',
      label: 'Accounts',
      type: 'object',
      objectName: 'account',
    });
    expect(item.order).toBeUndefined();
    expect(item.badge).toBeUndefined();
    expect(item.requiredPermissions).toBeUndefined();
  });
});

describe('ReportNavItemSchema', () => {
  it('should accept report nav item', () => {
    const navItem = {
      id: 'nav_sales_report',
      label: 'Sales Report',
      icon: 'file-text',
      type: 'report' as const,
      reportName: 'quarterly_sales',
    };

    const result = ReportNavItemSchema.parse(navItem);
    expect(result.type).toBe('report');
    expect(result.reportName).toBe('quarterly_sales');
  });

  it('should accept report nav item via NavigationItemSchema', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_pipeline_report',
      label: 'Pipeline Report',
      type: 'report',
      reportName: 'pipeline_overview',
      order: 5,
    });
    expect(item.type).toBe('report');
    expect(item.reportName).toBe('pipeline_overview');
  });

  it('should reject report nav item without reportName', () => {
    expect(() => ReportNavItemSchema.parse({
      id: 'nav_bad_report',
      label: 'Bad Report',
      type: 'report',
    })).toThrow();
  });
});

describe('ActionNavItemSchema', () => {
  it('should accept action nav item', () => {
    const navItem = {
      id: 'nav_new_lead',
      label: 'New Lead',
      icon: 'plus',
      type: 'action' as const,
      actionDef: {
        actionName: 'create_lead',
      },
    };

    const result = ActionNavItemSchema.parse(navItem);
    expect(result.type).toBe('action');
    expect(result.actionDef.actionName).toBe('create_lead');
  });

  it('should accept action nav item with params', () => {
    const result = ActionNavItemSchema.parse({
      id: 'nav_run_flow',
      label: 'Run Flow',
      type: 'action',
      actionDef: {
        actionName: 'launch_approval_flow',
        params: { recordType: 'contract', priority: 'high' },
      },
    });
    expect(result.actionDef.params).toEqual({ recordType: 'contract', priority: 'high' });
  });

  it('should accept action nav item via NavigationItemSchema', () => {
    const item = NavigationItemSchema.parse({
      id: 'nav_export',
      label: 'Export Data',
      type: 'action',
      actionDef: { actionName: 'export_csv' },
      badge: 'New',
    });
    expect(item.type).toBe('action');
    expect(item.actionDef.actionName).toBe('export_csv');
  });

  it('should reject action nav item without actionDef', () => {
    expect(() => ActionNavItemSchema.parse({
      id: 'nav_bad_action',
      label: 'Bad Action',
      type: 'action',
    })).toThrow();
  });
});

describe('NavigationAreaSchema', () => {
  it('should accept minimal area', () => {
    const area = NavigationAreaSchema.parse({
      id: 'area_sales',
      label: 'Sales',
      navigation: [],
    });
    expect(area.id).toBe('area_sales');
    expect(area.navigation).toEqual([]);
  });

  it('should accept area with full properties', () => {
    // The area's own `visible` / `requiredPermissions` went out in 17.0.0
    // (#4651) — they gated nothing. Every gate this area declares now sits on
    // an ITEM, which is the layer that is actually evaluated.
    const area = NavigationAreaSchema.parse({
      id: 'area_service',
      label: 'Service',
      icon: 'headset',
      description: 'Customer service management',
      navigation: [
        {
          id: 'nav_cases', type: 'object', label: 'Cases', objectName: 'case',
          requiredPermissions: ['service.access'],
        },
        {
          id: 'nav_knowledge', type: 'page', label: 'Knowledge Base', pageName: 'knowledge_base',
          visible: 'user.has_permission("service.access")',
        },
      ],
    });
    expect(area.id).toBe('area_service');
    expect(area.icon).toBe('headset');
    expect(area.navigation).toHaveLength(2);
    expect(area.navigation[0]).toMatchObject({ requiredPermissions: ['service.access'] });
  });

  it('should enforce snake_case for area id', () => {
    expect(() => NavigationAreaSchema.parse({
      id: 'AreaSales',
      label: 'Sales',
      navigation: [],
    })).toThrow();
  });
});

describe('AppSchema with areas', () => {
  it('should accept app with areas', () => {
    const app = AppSchema.parse({
      name: 'enterprise_crm',
      label: 'Enterprise CRM',
      areas: [
        {
          id: 'area_sales',
          label: 'Sales',
          icon: 'briefcase',
          navigation: [
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
            { id: 'nav_opportunities', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
          ],
        },
        {
          id: 'area_service',
          label: 'Service',
          icon: 'headset',
          navigation: [
            { id: 'nav_cases', type: 'object', label: 'Cases', objectName: 'case' },
          ],
        },
        {
          id: 'area_settings',
          label: 'Settings',
          icon: 'settings',
          navigation: [
            // The gate moved DOWN one level in 17.0.0 (#4651): on the area it
            // was fail-open theatre, on the item it is stripped server-side
            // and re-checked in the shell.
            {
              id: 'nav_users', type: 'object', label: 'Users', objectName: 'user',
              requiredPermissions: ['admin.access'],
            },
          ],
        },
      ],
    });

    expect(app.areas).toHaveLength(3);
    expect(app.areas![0].id).toBe('area_sales');
    expect(app.areas![0].navigation).toHaveLength(2);
    expect(app.areas![2].navigation[0]).toMatchObject({ requiredPermissions: ['admin.access'] });
  });

  it('should accept app with both navigation and areas (backward compatibility)', () => {
    const app = AppSchema.parse({
      name: 'hybrid_app',
      label: 'Hybrid App',
      navigation: [
        { id: 'nav_home', type: 'dashboard', label: 'Home', dashboardName: 'home' },
      ],
      areas: [
        {
          id: 'area_main',
          label: 'Main',
          navigation: [
            { id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'account' },
          ],
        },
      ],
    });
    expect(app.navigation).toHaveLength(1);
    expect(app.areas).toHaveLength(1);
  });

  it('should accept app without areas (backward compatibility)', () => {
    const app = AppSchema.parse({
      name: 'simple_app',
      label: 'Simple App',
      navigation: [
        { id: 'nav_home', type: 'object', label: 'Home', objectName: 'account' },
      ],
    });
    expect(app.areas).toBeUndefined();
    expect(app.navigation).toHaveLength(1);
  });

  it('should accept enterprise app with areas containing all nav item types', () => {
    const app = AppSchema.parse({
      name: 'full_enterprise',
      label: 'Full Enterprise',
      areas: [
        {
          id: 'area_main',
          label: 'Main',
          navigation: [
            { id: 'nav_home', type: 'dashboard', label: 'Home', dashboardName: 'home' },
            { id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'account', order: 1 },
            { id: 'nav_custom', type: 'page', label: 'Custom Page', pageName: 'custom' },
            { id: 'nav_report', type: 'report', label: 'Sales Report', reportName: 'quarterly_sales' },
            { id: 'nav_action', type: 'action', label: 'New Lead', actionDef: { actionName: 'create_lead' } },
            { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://docs.example.com', target: '_blank' },
            {
              id: 'grp_nested',
              type: 'group',
              label: 'Nested',
              expanded: true,
              children: [
                { id: 'nav_nested_item', type: 'object', label: 'Nested Item', objectName: 'nested', badge: 3 },
              ],
            },
          ],
        },
      ],
    });

    expect(app.areas).toHaveLength(1);
    expect(app.areas![0].navigation).toHaveLength(7);
  });
});

// #4001 (app step, PR A) — the seven keys the 2026-06 AppSchema liveness audit
// verdicted DEAD are retiredKey() tombstones: tsc-level `never` for typed
// authors, and a parse-time prescription for everyone else. Not a silent
// strip: AppSchema is not yet .strict(), so a bare deletion would have
// reintroduced the exact failure mode this campaign eliminates.
describe('retired dead keys carry prescriptions (#4001)', () => {
  it.each([
    ['version', '1.0.0', 'manifest.version'],
    // ⚠️ The expected fragment used to be `component/widget`. The widget half
    // of that prescription named `dashboard.widgets[].aria`, retired by #5010
    // in this same 17.0.0 — so the pin held `App.aria`'s prescription pointing
    // at another tombstone (#6756). Re-aimed at the surviving carrier.
    ['aria', { label: 'x' }, 'page.components[].aria'],
    ['objects', [], 'defineStack'],
    ['apis', [], 'defineStack'],
  ] as const)('rejects `%s` with its upgrade prescription', (key, value, fragment) => {
    const result = AppSchema.safeParse({ name: 'app_x', label: 'X', [key]: value });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain(fragment);
  });

  it('an app without any retired key parses unchanged', () => {
    expect(() => AppSchema.parse({
      name: 'clean_app', label: 'Clean',
      navigation: [{ id: 'nav_home', label: 'Home', type: 'object', objectName: 'account' }],
    })).not.toThrow();
  });

  // #5238 (#5040 E9) — the `apis` tombstone redirects to `defineStack({ apis })`,
  // so it also has to be TRUE about what that surface does. It used to add "which
  // is ALSO not executable in v17 (#4936) … until the endpoint executor ships",
  // and the executor shipped: an author following the prescription today would be
  // told to move a declaration to a place the same sentence calls dead, and would
  // reasonably keep serving the route from handler code instead.
  //
  // The assertions below are deliberately two-sided. Asserting only the presence
  // of the new words would keep passing if the retired claim were re-added
  // underneath them, and asserting only the absence would pass on an empty
  // string — the vacuity the surrounding pins exist to avoid.
  describe('the `apis` prescription tracks the executor (#5238)', () => {
    const prescription = (): string => {
      const result = AppSchema.safeParse({ name: 'app_x', label: 'X', apis: [] });
      expect(result.success).toBe(false);
      return result.error!.issues.map((i) => i.message).join('\n');
    };

    it('states the stack-level surface EXECUTES, and where the endpoint may live', () => {
      const messages = prescription();
      expect(messages).toContain('defineStack({ apis })');
      expect(messages).toContain('EXECUTES from protocol 17');
      // The one edit an author moving a declaration up must make (ADR-0121 D1/D2).
      expect(messages).toContain('/api/v1/apps/<manifest.namespace>/<subpath>');
      // The key whose wrong answer is unrecoverable, plus its D6 obligation.
      expect(messages).toContain('`authRequired` defaults to `true`');
      expect(messages).toContain('enabled: true');
      // Where the full security review lives — one source of truth, not a copy.
      expect(messages).toContain('declarative-apis-endpoints-live');
    });

    it('no longer tells the author that stack-level `apis:` is rejected', () => {
      const messages = prescription();
      expect(messages).not.toContain('not executable in v17');
      expect(messages).not.toContain('until the endpoint executor ships');
      // The historical fact stays: #4936 happened, and the prescription says so.
      expect(messages).toContain('#4936');
    });
  });
});

// #4001 (app step, PR B) — the app shell is `.strict()`, and the nav-item
// union is DISCRIMINATED on `type` so strict stays readable: one unknown key
// yields one issue against the branch the author actually wrote, at an exact
// path, instead of an `invalid_union` wall naming all nine branches.
describe('unknown keys are rejected, not stripped (#4001 PR B)', () => {
  const unknownKeyIssue = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i: { code: string }) => i.code === 'unrecognized_keys');
  };
  const navItem = (extra: Record<string, unknown>) => ({
    name: 'app_x', label: 'X',
    navigation: [{ id: 'nav_a', label: 'A', type: 'object', objectName: 'account', ...extra }],
  });

  describe('AppSchema', () => {
    it('rejects an undeclared key instead of silently dropping it', () => {
      expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', notAKey: 1 })!.message)
        .toContain('`notAKey`');
    });

    it('points sidebar vocabulary at `navigation`', () => {
      for (const key of ['menu', 'sidebar', 'tabs', 'items']) {
        expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', [key]: [] })!.message)
          .toContain(`\`${key}\` → \`navigation\``);
      }
    });

    it('explains where pages/views/flows really live', () => {
      expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', pages: [] })!.message)
        .toContain("type: 'page'");
      expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', views: [] })!.message)
        .toContain('listViews');
      expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', flows: [] })!.message)
        .toContain('defineStack');
    });

    it('keeps the PR A tombstone prescriptions rather than a bare strict error', () => {
      const result = AppSchema.safeParse({ name: 'app_a', label: 'A', sharing: { enabled: true } });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.message).join('\n')).toContain('FormView.sharing');
    });

    // #4829 — the ADR-0045 publish gate's acceptance face, both directions.
    //
    // `_unpublished` is machine-managed but DECLARED, because the write path
    // validates against this very schema (`saveMetaItem` → 422;
    // `Registry.validate('app', …)` → `AppSchema.parse`): an undeclared key
    // would make the platform's own visibility flip unwritable. What keeps it
    // out of an author's hands is the `_` prefix plus the prescriptions below —
    // so both halves are pinned, or "machine-managed" is only a comment.
    it('accepts the machine-managed `_unpublished` gate — the flip has to be writable', () => {
      expect(AppSchema.safeParse({ name: 'app_a', label: 'A', _unpublished: true }).success).toBe(true);
      expect(AppSchema.safeParse({ name: 'app_a', label: 'A', _unpublished: false }).success).toBe(true);
    });

    it('answers the author-shaped publish spellings with "not authorable", never a rename', () => {
      // A bare edit-distance suggestion here would read "did you mean
      // `_unpublished`?" — teaching the one thing the key exists to prevent.
      for (const key of ['unpublished', 'published', 'draft']) {
        const message = unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', [key]: true })!.message;
        expect(message).toContain('Publish state is not authorable');
        expect(message).toContain('publish-drafts');
        expect(message).not.toMatch(new RegExp(`\`${key}\`\\s*→`));
      }
    });

    it('still accepts `hidden` — it keeps its (navigation-only) authoring contract', () => {
      // The Account app's shape. Retiring `hidden` was NOT the fix: the key was
      // never wrong, the second contract layered onto it was.
      expect(AppSchema.safeParse({ name: 'account', label: 'Account', hidden: true }).success).toBe(true);
    });
  });

  describe('navigation items (discriminated union)', () => {
    it('reports ONE issue against the matched branch, not a union wall', () => {
      const result = AppSchema.safeParse(navItem({ viewname: 'all' }));
      expect(result.success).toBe(false);
      const unrecognized = result.error!.issues.filter((i) => i.code === 'unrecognized_keys');
      expect(unrecognized).toHaveLength(1);
      expect(result.error!.issues.some((i) => i.code === 'invalid_union')).toBe(false);
      expect(unrecognized[0].message).toContain('`viewname` → `viewName`');
    });

    it('points `visibleWhen` at `visible` so a nav gate cannot fail open', () => {
      // ADR-0089 made visibleWhen canonical on view/page; borrowing it here
      // used to STRIP the gate and render the entry unconditionally.
      expect(unknownKeyIssue(AppSchema, navItem({ visibleWhen: 'x == 1' }))!.message)
        .toContain('`visibleWhen` → `visible`');
    });

    it('points a wrong-variant payload at the type that owns it', () => {
      const result = AppSchema.safeParse({
        name: 'app_a', label: 'A',
        navigation: [{ id: 'nav_u', label: 'U', type: 'url', url: 'https://x', pageName: 'p' }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.issues.find((i) => i.code === 'unrecognized_keys')!.message)
        .toContain("type: 'page'");
    });

    it('gives a precise path for an unknown key nested in children', () => {
      const result = AppSchema.safeParse({
        name: 'app_a', label: 'A',
        navigation: [{
          id: 'grp', label: 'G', type: 'group',
          children: [{ id: 'nav_a', label: 'A', type: 'object', objectName: 'account', bogus: 1 }],
        }],
      });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue!.path).toEqual(['navigation', 0, 'children', 0]);
    });

    it('reports a mistyped `type` as a discriminator error, not an unknown key', () => {
      const result = AppSchema.safeParse({
        name: 'app_a', label: 'A',
        navigation: [{ id: 'nav_a', label: 'A', type: 'objct', objectName: 'account' }],
      });
      expect(result.success).toBe(false);
      const message = result.error!.issues.map((i) => i.message).join('\n');
      expect(message).toContain('Invalid discriminator value');
    });

    it('keeps the objectNavTargetExclusivity refinement working inside the union', () => {
      const result = AppSchema.safeParse({
        name: 'app_a', label: 'A',
        navigation: [{
          id: 'nav_a', label: 'A', type: 'object', objectName: 'account',
          filters: { owner_id: '{current_user_id}' }, viewName: 'all',
        }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.message).join('\n')).toContain('pick ONE landing');
    });

    it('leaves page/component/action params OPEN (the target owns that contract)', () => {
      expect(() => AppSchema.parse({
        name: 'app_a', label: 'A',
        navigation: [
          { id: 'nav_p', label: 'P', type: 'page', pageName: 'p', params: { anything: 1, nested: { x: 2 } } },
          { id: 'nav_c', label: 'C', type: 'component', componentRef: 'metadata:resource', params: { type: 'object' } },
          { id: 'nav_x', label: 'X', type: 'action', actionDef: { actionName: 'go', params: { free: 'form' } } },
        ],
      })).not.toThrow();
    });

    it('rejects unknown keys inside actionDef', () => {
      const result = AppSchema.safeParse({
        name: 'app_a', label: 'A',
        navigation: [{ id: 'nav_x', label: 'X', type: 'action', actionDef: { actionName: 'go', args: {} } }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.issues.find((i) => i.code === 'unrecognized_keys')!.message)
        .toContain('`args` → `params`');
    });

    it('accepts every variant with its full declared payload', () => {
      expect(() => AppSchema.parse({
        name: 'app_a', label: 'A',
        navigation: [
          { id: 'n1', label: 'O', type: 'object', objectName: 'account', viewName: 'all', icon: 'x', order: 1, badge: '3', badgeVariant: 'default', visible: 'true', requiredPermissions: ['p'], requiresObject: 'account', requiresService: 'ai' },
          { id: 'n2', label: 'D', type: 'dashboard', dashboardName: 'd' },
          { id: 'n3', label: 'P', type: 'page', pageName: 'p' },
          { id: 'n4', label: 'U', type: 'url', url: 'https://x', target: '_blank' },
          { id: 'n5', label: 'R', type: 'report', reportName: 'r' },
          { id: 'n6', label: 'A', type: 'action', actionDef: { actionName: 'go' } },
          { id: 'n7', label: 'C', type: 'component', componentRef: 'metadata:directory' },
          { type: 'separator', id: 'sep_1', order: 5 },
          { id: 'n8', label: 'G', type: 'group', expanded: true, children: [{ id: 'n9', label: 'X', type: 'url', url: 'https://y' }] },
        ],
      })).not.toThrow();
    });
  });

  describe('app sub-schemas', () => {
    it('rejects unknown keys on branding, areas, and context selectors', () => {
      expect(unknownKeyIssue(AppSchema, { name: 'app_a', label: 'A', branding: { primary: '#fff' } })!.message)
        .toContain('`primary` → `primaryColor`');
      expect(unknownKeyIssue(AppSchema, {
        name: 'app_a', label: 'A', areas: [{ id: 'ar', label: 'A', navigation: [], items: [] }],
      })!.message).toContain('`items` → `navigation`');
      expect(unknownKeyIssue(AppSchema, {
        name: 'app_a', label: 'A',
        contextSelectors: [{ id: 'pkg', label: 'P', optionsSource: { endpoint: '/x', url: '/y' } }],
      })!.message).toContain('`url` → `endpoint`');
    });

    it('rejects unknown keys on a navigation contribution', () => {
      expect(unknownKeyIssue(NavigationContributionSchema, {
        app: 'setup', items: [], targetGroup: 'g',
      })!.message).toContain('`targetGroup` → `group`');
    });
  });

  // ── Context-selector keys retired in 17.0.0 (#4509, ADR-0049) ─────────────
  describe('retired context-selector keys', () => {
    const withSelector = (extra: Record<string, unknown>) => ({
      name: 'app_a',
      label: 'A',
      contextSelectors: [{
        id: 'pkg', label: 'Package',
        optionsSource: { endpoint: '/api/v1/packages' },
        ...extra,
      }],
    });

    it('rejects `includeAll` with the mandatory-scope reason, not a bare "unknown key"', () => {
      // The reason matters more than the rejection here. `includeAll` was not
      // merely unread — the shell deliberately disobeyed it, because an "All"
      // row clears a scope that exists to be mandatory, and on Studio's package
      // selector that means listing the platform's own kernel packages. An
      // author who only learns "removed" may go looking for the replacement
      // knob; there is none, and this message has to say why.
      const msg = unknownKeyIssue(AppSchema, withSelector({ includeAll: true }))!.message;
      expect(msg).toMatch(/includeAll.*removed.*17\.0\.0/s);
      expect(msg).toMatch(/mandatory|clear the scope/is);
      expect(msg).toMatch(/optionsSource\.filter/s);
    });

    it('rejects `placement` and says the topbar never existed', () => {
      const msg = unknownKeyIssue(AppSchema, withSelector({ placement: 'topbar' }))!.message;
      expect(msg).toMatch(/placement.*removed.*17\.0\.0/s);
      expect(msg).toMatch(/sidebar header/s);
    });

    it('routes the retired alias spellings to the same prescriptions', () => {
      expect(unknownKeyIssue(AppSchema, withSelector({ showall: true }))!.message)
        .toMatch(/includeAll.*removed/s);
      expect(unknownKeyIssue(AppSchema, withSelector({ location: 'topbar' }))!.message)
        .toMatch(/placement.*removed/s);
    });

    it('keeps `allValue` — it is the no-selection sentinel, not an "All" value', () => {
      // The one key whose verdict had to be RE-checked when includeAll went:
      // its ledger note asked for exactly that. It survives because the shell
      // really does read it (auto-selection + query-param defaulting) — only
      // its documented rationale was wrong.
      const parsed = AppSchema.parse(withSelector({ allValue: '' }));
      expect(parsed.contextSelectors![0].allValue).toBe('');
      expect(parsed.contextSelectors![0]).not.toHaveProperty('includeAll');
      expect(parsed.contextSelectors![0]).not.toHaveProperty('placement');
    });
  });
  // ── homePageId / areas[].order retired in 17.0.0 (#4667, ADR-0049) ────────
  describe('retired app keys (#4667)', () => {
    it('rejects `homePageId` and names what actually decides the landing page', () => {
      // Tombstoned (retiredKey), matching the seven #4142 retirements on this
      // schema — so it is a tsc error as well as a parse error. Post-v17 the
      // landing page really is the first navigation item; what the message must
      // NOT do is explain *why* by claiming nobody read the key (see below).
      const parse = () => AppSchema.parse({
        name: 'crm', label: 'CRM', homePageId: 'nav_pipeline',
        navigation: [{ id: 'nav_home', type: 'object', label: 'Home', objectName: 'account' }],
      });
      expect(parse).toThrow(/homePageId.*removed.*17\.0\.0/s);
      expect(parse).toThrow(/first navigation item/s);
      expect(parse).toThrow(/isDefault/s);
    });

    it('the tombstone states the REAL reason, not the false "no shell read it" premise (#4709)', () => {
      // #4667 shipped this tombstone claiming "no shell ever read it". It was
      // false — objectui's console read the key in `resolveLandingRoute()`
      // (packages/app-shell/src/console/AppContent.tsx @785b8a5d) and it was the
      // only thing deciding where an app opened — and it contradicted this
      // repo's own 2026-06 AppSchema liveness audit, which listed the key LIVE.
      // The removal stands (#4709 ruling B): the key encoded the landing page as
      // an ID cross-reference that silently fell back when it dangled. Pinned
      // because a tombstone is what the next reader reasons FROM: this sentence
      // already sent one session to the renderer to discover it was wrong, and a
      // regression would re-arm exactly that trap.
      const parse = () => AppSchema.parse({
        name: 'crm', label: 'CRM', homePageId: 'nav_pipeline',
        navigation: [{ id: 'nav_home', type: 'object', label: 'Home', objectName: 'account' }],
      });
      expect(parse).not.toThrow(/no shell ever read/i);
      expect(parse).toThrow(/did read it/i);
      expect(parse).toThrow(/resolveLandingRoute/);
      // The prescription is unchanged by the correction — reorder, or isDefault.
      expect(parse).toThrow(/reorder `navigation`/s);
    });

    it('routes the three retired homePageId aliases to the same prescription', () => {
      for (const alias of ['home', 'homepage', 'landingpage']) {
        expect(unknownKeyIssue(AppSchema, { name: 'crm', label: 'CRM', [alias]: 'nav_x' })!.message)
          .toMatch(/homePageId.*removed/s);
      }
    });

    it('rejects `areas[].order` and distinguishes it from the nav-item `order` that IS sorted', () => {
      // The sibling that works is why this one read alive. The message must say
      // so, or an author concludes ordering is unsupported and restructures the
      // navigation tree for no reason.
      const msg = unknownKeyIssue(AppSchema, {
        name: 'crm', label: 'CRM',
        areas: [{ id: 'area_sales', label: 'Sales', order: 1, navigation: [] }],
      })!.message;
      expect(msg).toMatch(/order.*removed.*17\.0\.0/s);
      expect(msg).toMatch(/reorder the\s+`areas` array/s);
      expect(msg).toMatch(/navigation ITEM/s);
    });

    it('the `sort` alias on an area carries the same prescription', () => {
      expect(unknownKeyIssue(AppSchema, {
        name: 'crm', label: 'CRM',
        areas: [{ id: 'a', label: 'A', sort: 1, navigation: [] }],
      })!.message).toMatch(/order.*removed/s);
    });

    it('an app without either key still parses', () => {
      const app = AppSchema.parse({
        name: 'crm', label: 'CRM',
        areas: [{ id: 'area_sales', label: 'Sales', navigation: [] }],
        navigation: [{ id: 'nav_home', type: 'object', label: 'Home', objectName: 'account' }],
      });
      expect(app).not.toHaveProperty('homePageId');
      expect(app.areas![0]).not.toHaveProperty('order');
    });
  });

  // ── areas[].visible / areas[].requiredPermissions, 17.0.0 (#4651) ─────────
  //
  // These were FAIL-OPEN gates, which is why the rejections below assert the
  // reason and not just the refusal: an author who reads only "removed" goes
  // looking for the replacement knob on the area, and there is none. The
  // message has to move them one level down (per item) or one level up (per
  // app) — the two layers that are actually enforced.
  describe('retired fail-open area gates (#4651)', () => {
    const withArea = (extra: Record<string, unknown>) => ({
      name: 'crm', label: 'CRM',
      areas: [{ id: 'area_admin', label: 'Admin', navigation: [], ...extra }],
    });

    it('rejects `areas[].requiredPermissions` and names the layers that DO enforce', () => {
      const msg = unknownKeyIssue(AppSchema, withArea({ requiredPermissions: ['sales.admin'] }))!.message;
      expect(msg).toMatch(/requiredPermissions.*removed.*17\.0\.0/s);
      // The class, not just the fact: fail-open is why this is a defect rather
      // than dead weight, and it is what tells the author to re-audit anything
      // they believed this key protected.
      expect(msg).toMatch(/fail-open|every user/is);
      // The two enforced layers, named.
      expect(msg).toMatch(/on the APP/s);
      expect(msg).toMatch(/navigation ITEM/s);
      // #4722 closed the caveat this prescription used to carry ("the server
      // does not walk `areas`", so an item gate inside an area was shell-side
      // only). The pin moves to the CORRECTED fact rather than being deleted:
      // an author who reads a prescription that has simply gone quiet about
      // `areas[]` concludes the old boundary still holds, which is the same
      // false belief one step further from the evidence.
      expect(msg).toMatch(/BOTH trees/s);
      expect(msg).toMatch(/areas\[\]\.navigation/s);
      expect(msg).toMatch(/#4722/s);
      // The asymmetry that SURVIVES #4722 — and the reason this is the layer
      // an author must reach for: `requiredPermissions` is enforced before the
      // body ships, `visible` is not evaluated until it is already in the
      // browser. Dropping this half would trade the old false belief for the
      // one #4722 makes newly tempting ("areas are gated now, `visible` is
      // fine").
      expect(msg).toMatch(/client-side ONLY/s);
      expect(msg).toMatch(/`visible` \(CEL\)/s);
      expect(msg).toMatch(/never in `visible`/s);
      // The retirement itself is untouched: enforcing the items inside an area
      // is not a revived area-LEVEL gate, and the message must not read as one.
      expect(msg).toMatch(/not revived/s);
      // Belt and braces on the specific claim this pin replaced.
      expect(msg).not.toMatch(/does not walk/i);
    });

    it('rejects `areas[].visible` and points at the item-level CEL gate that is evaluated', () => {
      const msg = unknownKeyIssue(AppSchema, withArea({ visible: "'admin' in current_user.positions" }))!.message;
      expect(msg).toMatch(/visible.*removed.*17\.0\.0/s);
      expect(msg).toMatch(/fails open|EVERYONE/s);
      expect(msg).toMatch(/navigation ITEM's `visible`/s);
      // #4722 also moved where a SERVER-enforced gate may live, and this
      // prescription's closing enumeration had not followed. It used to name
      // the top-level tree as the only item-level destination, which sends an
      // author already standing inside an area off to restructure their
      // navigation for a gate they can now write in place. Pin the corrected
      // enumeration rather than merely the absence of the old one.
      expect(msg).toMatch(/either navigation tree/s);
      expect(msg).toMatch(/areas\[\]\.navigation/s);
      expect(msg).toMatch(/#4722/s);
      // …and do NOT let that drag `visible`'s own verdict along: #4722 changed
      // nothing about CEL, which is still evaluated in the browser at every
      // level. That asymmetry is the entire reason this prescription can send a
      // must-never-ship gate to `requiredPermissions` rather than to an item's
      // `visible` — the destination it would otherwise be natural to reach for,
      // since the author arrived here holding a CEL expression.
      expect(msg).toMatch(/evaluated in the browser/s);
      expect(msg).toMatch(/navigation ITEM's `visible` takes the same CEL expression/s);
      // Negative pin on the enumeration this replaced.
      expect(msg).not.toMatch(/on items of the app's top-level/s);
    });

    it('routes the retired gating aliases to the same prescriptions', () => {
      // `visibleWhen` / `visibleOn` / `permissions` used to RENAME onto the two
      // keys this issue removed. An alias pointing at a key that is itself gone
      // answers an unknown key with a second unknown key, so each became a
      // prescription instead (the #4667 `sort` precedent).
      for (const alias of ['visibleWhen', 'visibleOn']) {
        expect(unknownKeyIssue(AppSchema, withArea({ [alias]: 'x' }))!.message)
          .toMatch(/`areas\[\]\.visible` was removed/s);
      }
      expect(unknownKeyIssue(AppSchema, withArea({ permissions: ['x'] }))!.message)
        .toMatch(/`areas\[\]\.requiredPermissions` was removed/s);
    });

    it('an area gating nothing still parses, and the ITEM-level gates are untouched', () => {
      // The removal must not take the working gate with it: the item keys are
      // spelled identically, one level down, and they are the prescription's
      // destination.
      const app = AppSchema.parse({
        name: 'crm', label: 'CRM',
        areas: [{
          id: 'area_admin', label: 'Admin',
          navigation: [{
            id: 'nav_users', type: 'object', label: 'Users', objectName: 'user',
            requiredPermissions: ['admin.access'],
            visible: "'admin' in current_user.positions",
            requiresService: 'org-scoping',
          }],
        }],
      });
      expect(app.areas![0]).not.toHaveProperty('visible');
      expect(app.areas![0]).not.toHaveProperty('requiredPermissions');
      expect(app.areas![0].navigation[0]).toMatchObject({
        requiredPermissions: ['admin.access'],
        requiresService: 'org-scoping',
      });
      expect(app.areas![0].navigation[0]).toHaveProperty('visible');
    });

    it('the APP-level `requiredPermissions` gate is untouched by this removal', () => {
      // The other enforced layer the prescription names (rest-server's
      // filterAppForUser drops the whole app). Pinned here so "we removed the
      // area gate" can never quietly become "we removed the app gate too".
      const app = AppSchema.parse({
        name: 'crm', label: 'CRM', requiredPermissions: ['crm.access'],
        navigation: [{ id: 'nav_home', type: 'object', label: 'Home', objectName: 'account' }],
      });
      expect(app.requiredPermissions).toEqual(['crm.access']);
    });

    // The type-level half, and the only way to measure it that is not a no-op.
    //
    // `NavigationArea` is a TYPE — erased before any runtime assertion can see
    // it — and when this was written an `Assert< Equal< … > >` pin in this file
    // would never have run: `packages/spec/tsconfig.json` excluded
    // `**/*.test.ts` and vitest does not type-check (#4642; the tsconfig half is
    // closed by #5286). Every assertion above would stay green if the two
    // keys were re-added to the schema's TS shape while the parse kept
    // rejecting them. This resolves the exported type through the TypeScript
    // compiler API and reads its members — the same symbol-identity measurement
    // `check:dual-source-exports` makes, over `src/`, so it runs in `pnpm test`
    // without a build.
    it('the retired gates are gone from the TYPE, not only from the parse (compiler API)', async () => {
      const ts = (await import('typescript')).default;
      const { resolve, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const entry = resolve(dirname(fileURLToPath(import.meta.url)), 'app.zod.ts');
      const program = ts.createProgram([entry], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      });
      const checker = program.getTypeChecker();
      const sf = program.getSourceFile(entry);
      // Guard #1: a resolution failure would make every assertion below pass
      // vacuously — the exact way a gate goes dormant (#4642).
      expect(sf, 'app.zod.ts must resolve').toBeTruthy();
      const moduleSym = checker.getSymbolAtLocation(sf!);
      expect(moduleSym, 'app.zod.ts module symbol must resolve').toBeTruthy();

      const areaSym = checker
        .getExportsOfModule(moduleSym!)
        .find((s) => s.getName() === 'NavigationArea');
      expect(areaSym, 'NavigationArea must be exported').toBeTruthy();

      const props = checker
        .getDeclaredTypeOfSymbol(areaSym!)
        .getProperties()
        .map((p) => p.getName())
        .sort();

      // Guard #2: the alias really resolved to the object shape. Without this,
      // a `z.infer` that degraded to `any`/`unknown` would report ZERO members
      // and the two negatives below would pass while the type said nothing.
      expect(props).toEqual(['description', 'icon', 'id', 'label', 'navigation']);
      expect(props).not.toContain('visible');
      expect(props).not.toContain('requiredPermissions');
    });
  });
});
