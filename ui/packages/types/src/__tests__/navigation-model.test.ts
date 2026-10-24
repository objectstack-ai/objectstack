/**
 * Tests for Unified Navigation Model
 * 
 * Validates NavigationItem, NavigationArea types, Zod schemas,
 * and the AppMenuItem → NavigationItem transform.
 */
import { describe, it, expect } from 'vitest';
import {
  AppComponentSchema,
  NavigationItemSchema,
  NavigationAreaSchema,
} from '../zod/index.zod';
import { menuItemToNavigationItem } from '../app';
import type { AppMenuItem, NavigationItem, NavigationArea } from '../app';

// ============================================================================
// NavigationItem Zod Schema
// ============================================================================

describe('NavigationItem Zod Schema', () => {
  it('should validate an object navigation item', () => {
    const item = {
      id: 'nav_contacts',
      type: 'object',
      label: 'Contacts',
      icon: 'Users',
      objectName: 'contact',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate a dashboard navigation item', () => {
    const item = {
      id: 'nav_dash',
      type: 'dashboard',
      label: 'Overview',
      icon: 'BarChart3',
      dashboardName: 'sales_overview',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate a page navigation item', () => {
    const item = {
      id: 'nav_settings',
      type: 'page',
      label: 'Settings',
      pageName: 'app_settings',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate a report navigation item', () => {
    const item = {
      id: 'nav_report',
      type: 'report',
      label: 'Sales Report',
      reportName: 'monthly_sales',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate a url navigation item', () => {
    const item = {
      id: 'nav_docs',
      type: 'url',
      label: 'Documentation',
      url: 'https://docs.example.com',
      target: '_blank',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  // #2918 — `type: 'component'` was implemented in the renderers but rejected
  // by this schema, so authors could not declare it at all.
  it('should validate a component navigation item and keep componentRef/params', () => {
    const item = {
      id: 'nav_objects',
      type: 'component',
      label: 'Objects',
      componentRef: 'metadata:resource',
      params: { type: 'object' },
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    // The fields the renderer consumes must survive parse (zod strips
    // undeclared keys) — otherwise the item validates but renders `#`.
    expect(result.data.componentRef).toBe('metadata:resource');
    expect(result.data.params).toEqual({ type: 'object' });
  });

  it('should validate a group navigation item with children', () => {
    const item = {
      id: 'nav_sales_group',
      type: 'group',
      label: 'Sales',
      icon: 'DollarSign',
      defaultOpen: true,
      children: [
        { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
        { id: 'nav_opps', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
      ],
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate a separator navigation item', () => {
    const item = {
      id: 'sep_1',
      type: 'separator',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate UX enhancement fields', () => {
    const item = {
      id: 'nav_tasks',
      type: 'object',
      label: 'Tasks',
      objectName: 'task',
      badge: 5,
      badgeVariant: 'destructive',
      pinned: true,
      order: 10,
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should validate visibility and permission fields', () => {
    const item = {
      id: 'nav_admin',
      type: 'page',
      label: 'Admin Panel',
      pageName: 'admin',
      visible: "${user.role === 'admin'}",
      requiredPermissions: ['admin:read'],
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should reject invalid type', () => {
    const item = {
      id: 'nav_bad',
      type: 'invalid_type',
      label: 'Bad',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it('should reject missing required id', () => {
    const item = {
      type: 'object',
      label: 'No ID',
      objectName: 'contact',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  // INVERTED by objectui#9868 (was 'should reject missing required label' →
  // `success` false): `@objectstack/spec` 17.5.0 made an entry's `label`
  // optional — absent ⇒ the entry inherits its target's label at render time —
  // so a label-less entry is accepted, and nothing is filled in at parse time.
  it('should accept a missing label, adding none (objectui#9868)', () => {
    const item = {
      id: 'nav_no_label',
      type: 'object',
      objectName: 'contact',
    };
    const result = NavigationItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty('label');
  });
});

// ============================================================================
// NavigationArea Zod Schema
// ============================================================================

describe('NavigationArea Zod Schema', () => {
  it('should validate a complete area', () => {
    const area = {
      id: 'sales',
      label: 'Sales',
      icon: 'DollarSign',
      navigation: [
        { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
        { id: 'nav_opps', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
      ],
    };
    const result = NavigationAreaSchema.safeParse(area);
    expect(result.success).toBe(true);
  });

  it('should validate area with visibility and permissions', () => {
    const area = {
      id: 'admin_area',
      label: 'Administration',
      navigation: [
        { id: 'nav_users', type: 'object', label: 'Users', objectName: 'user' },
      ],
      visible: "${user.isAdmin}",
      requiredPermissions: ['admin:access'],
    };
    const result = NavigationAreaSchema.safeParse(area);
    expect(result.success).toBe(true);
  });

  it('should reject area without navigation', () => {
    const area = {
      id: 'empty_area',
      label: 'Empty',
    };
    const result = NavigationAreaSchema.safeParse(area);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AppSchema with navigation and areas
// ============================================================================

describe('AppComponentSchema with unified navigation', () => {
  it('should validate AppComponentSchema with navigation field', () => {
    const app = {
      type: 'app',
      name: 'crm',
      title: 'CRM App',
      layout: 'sidebar',
      navigation: [
        { id: 'nav_dash', type: 'dashboard', label: 'Dashboard', dashboardName: 'overview' },
        { id: 'nav_contacts', type: 'object', label: 'Contacts', objectName: 'contact' },
      ],
    };
    const result = AppComponentSchema.safeParse(app);
    expect(result.success).toBe(true);
  });

  it('should validate AppComponentSchema with areas', () => {
    const app = {
      type: 'app',
      name: 'enterprise_crm',
      title: 'Enterprise CRM',
      layout: 'sidebar',
      areas: [
        {
          id: 'sales',
          label: 'Sales',
          icon: 'DollarSign',
          navigation: [
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
          ],
        },
        {
          id: 'service',
          label: 'Service',
          icon: 'Headphones',
          navigation: [
            { id: 'nav_cases', type: 'object', label: 'Cases', objectName: 'case' },
          ],
        },
      ],
    };
    const result = AppComponentSchema.safeParse(app);
    expect(result.success).toBe(true);
  });

  it('should validate AppComponentSchema with both legacy menu and new navigation', () => {
    const app = {
      type: 'app',
      name: 'migration_app',
      menu: [
        { type: 'item', label: 'Home', path: '/home' },
      ],
      navigation: [
        { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
      ],
    };
    const result = AppComponentSchema.safeParse(app);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// AppMenuItem → NavigationItem Transform
// ============================================================================

describe('menuItemToNavigationItem', () => {
  it('should convert a simple path-based item', () => {
    const menuItem: AppMenuItem = {
      type: 'item',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      path: '/dashboard',
    };

    const result = menuItemToNavigationItem(menuItem, 0);
    expect(result.type).toBe('page');
    expect(result.label).toBe('Dashboard');
    expect(result.icon).toBe('LayoutDashboard');
    expect(result.pageName).toBe('/dashboard');
    expect(result.id).toBe('migrated_0');
  });

  it('should convert an external link item', () => {
    const menuItem: AppMenuItem = {
      type: 'item',
      label: 'Docs',
      href: 'https://docs.example.com',
    };

    const result = menuItemToNavigationItem(menuItem, 1);
    expect(result.type).toBe('url');
    expect(result.url).toBe('https://docs.example.com');
    expect(result.target).toBe('_blank');
  });

  it('should convert a group with children', () => {
    const menuItem: AppMenuItem = {
      type: 'group',
      label: 'Sales',
      children: [
        { type: 'item', label: 'Leads', path: '/leads' },
        { type: 'item', label: 'Opportunities', path: '/opportunities' },
      ],
    };

    const result = menuItemToNavigationItem(menuItem, 2);
    expect(result.type).toBe('group');
    expect(result.label).toBe('Sales');
    expect(result.children).toHaveLength(2);
    expect(result.children![0].type).toBe('page');
    expect(result.children![0].pageName).toBe('/leads');
    expect(result.defaultOpen).toBe(true);
  });

  it('should convert a separator', () => {
    const menuItem: AppMenuItem = { type: 'separator' };

    const result = menuItemToNavigationItem(menuItem, 3);
    // Only the spec separator's keys — no `label` (objectui#10867).
    expect(result).toEqual({ id: 'migrated_3', type: 'separator' });
  });

  it('should invert hidden to visible', () => {
    const menuItem: AppMenuItem = {
      type: 'item',
      label: 'Admin',
      path: '/admin',
      hidden: true,
    };

    const result = menuItemToNavigationItem(menuItem, 4);
    expect(result.visible).toBe(false);
  });

  it('should preserve badge', () => {
    const menuItem: AppMenuItem = {
      type: 'item',
      label: 'Notifications',
      path: '/notifications',
      badge: 42,
    };

    const result = menuItemToNavigationItem(menuItem, 5);
    expect(result.badge).toBe(42);
  });

  it('should handle item without explicit type', () => {
    const menuItem: AppMenuItem = {
      label: 'About',
      path: '/about',
    };

    const result = menuItemToNavigationItem(menuItem, 6);
    expect(result.type).toBe('page');
    expect(result.label).toBe('About');
  });
});

// ============================================================================
// Type-level sanity checks (compile-time assertions at runtime)
// ============================================================================

describe('Type exports', () => {
  it('should export NavigationItem type fields', () => {
    const item: NavigationItem = {
      id: 'test',
      type: 'object',
      label: 'Test',
      objectName: 'test_object',
      icon: 'Database',
      visible: true,
      requiredPermissions: ['test:read'],
      badge: 3,
      badgeVariant: 'default',
      pinned: false,
      order: 1,
    };
    expect(item.id).toBe('test');
    expect(item.type).toBe('object');
  });

  it('should export NavigationArea type fields', () => {
    const area: NavigationArea = {
      id: 'sales',
      label: 'Sales',
      icon: 'DollarSign',
      navigation: [
        // Gating moved to the ITEM in spec 17.0.0: `visible` and
        // `requiredPermissions` were retired at AREA level, since an area is a
        // layout grouping and not an access boundary.
        {
          id: 'nav_leads',
          type: 'object',
          label: 'Leads',
          objectName: 'lead',
          visible: true,
          requiredPermissions: ['sales:access'],
        },
      ],
    };
    expect(area.id).toBe('sales');
    expect(area.navigation).toHaveLength(1);
  });
});
