// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { SharingConfigSchema, EmbedConfigSchema } from './sharing.zod';

/**
 * Base Navigation Item Schema
 * Shared properties for all navigation types.
 * 
 * **NAMING CONVENTION:**
 * Navigation item IDs are used in URLs and configuration and must be lowercase snake_case.
 * 
 * @example Good IDs
 * - 'menu_accounts'
 * - 'page_dashboard'
 * - 'nav_settings'
 * 
 * @example Bad IDs (will be rejected)
 * - 'MenuAccounts' (PascalCase)
 * - 'Page Dashboard' (spaces)
 */
import { lazySchema } from '../shared/lazy-schema';
const BaseNavItemSchema = z.object({
  /** Unique identifier for the item */
  id: SnakeCaseIdentifierSchema.describe('Unique identifier for this navigation item (lowercase snake_case)'),
  
  /** Display label */
  label: I18nLabelSchema.describe('Display proper label'),
  
  /** Icon name (Lucide) */
  icon: z.string().optional().describe('Icon name'),

  /** Sort order within the same level (lower numbers appear first) */
  order: z.number().optional().describe('Sort order within the same level (lower = first)'),

  /** Badge text or count displayed on the navigation item (e.g. "3", "New") */
  badge: z.union([z.string(), z.number()]).optional().describe('Badge text or count displayed on the item'),

  /** 
   * Visibility condition. 
   * Formula expression returning boolean. 
   * e.g. "user.is_admin || user.department == 'sales'"
   */
  visible: ExpressionInputSchema.optional().describe('Visibility predicate (CEL). e.g. P`os.user.role == "admin"`'),

  /** Permissions required to see/access this navigation item */
  requiredPermissions: z.array(z.string()).optional().describe('Permissions required to access this item'),

  /**
   * Capability gate — registered object name.
   *
   * When set, the frontend MUST hide (or render disabled) this navigation
   * entry if the named object is not registered in the runtime's
   * SchemaRegistry. Useful for cloud-only objects (e.g. `sys_app`,
   * `sys_package`, `sys_package_installation`) that don't exist in
   * single-environment runtimes — declaring the dependency here avoids
   * 404-when-clicked traps without hard-coding environment checks in the
   * UI.
   *
   * Independent of `visible` (CEL) and `requiredPermissions` (RBAC) —
   * this gates on runtime *capability*, not user authorization.
   */
  requiresObject: z.string().optional().describe('Hide/disable this entry unless the named object is registered in the runtime'),

  /**
   * Capability gate — registered service name.
   *
   * Same idea as `requiresObject` but keyed on a kernel service
   * (e.g. `'ai'`, `'tenant'`, `'realtime'`). Hide the entry when the
   * service isn't installed.
   */
  requiresService: z.string().optional().describe('Hide/disable this entry unless the named kernel service is registered'),
});

/**
 * 1. Object Navigation Item
 *
 * Navigates to an object's list view by default. When `recordId` is set,
 * navigates directly to that record's detail page instead — useful for
 * "My Profile", "My Settings", or any other always-one-row entry where
 * dropping the user on a list view first would be wrong UX.
 *
 * `recordId` supports a small set of template variables resolved at render
 * time by the shell (see Console's `AppSidebar` / `AppContent`):
 *   - `{current_user_id}` — the signed-in user's id
 *   - `{current_org_id}`  — the active organization id
 * These mirror the variables already understood by the view-layer
 * filter resolver (see e.g. `sys_user.me` listView), so authors only
 * have to learn one vocabulary.
 *
 * @example List view (existing behaviour)
 * ```ts
 * { id: 'nav_users', type: 'object', label: 'Users',
 *   objectName: 'sys_user', viewName: 'all_users' }
 * ```
 *
 * @example Direct-to-record (new)
 * ```ts
 * { id: 'nav_profile', type: 'object', label: 'My Profile',
 *   objectName: 'sys_user', recordId: '{current_user_id}' }
 * ```
 */
export const ObjectNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('object'),
  objectName: z.string().describe('Target object name'),
  viewName: z.string().optional().describe('Default list view to open. Defaults to "all". Ignored when `recordId` is set.'),
  /**
   * When set, navigate straight to the detail page of this specific
   * record instead of the object's list view. Supports template
   * variables `{current_user_id}` and `{current_org_id}` resolved by
   * the shell at render time. Mutually exclusive with `viewName`
   * (viewName is ignored if both are set).
   */
  recordId: z.string().optional().describe(
    'Navigate directly to this record id instead of the list view. Supports template vars: {current_user_id}, {current_org_id}.',
  ),
  /**
   * Open the record in view (default) or edit mode. Only meaningful
   * when `recordId` is set.
   */
  recordMode: z.enum(['view', 'edit']).optional().describe(
    'Open the record in view (default) or edit mode. Only meaningful when `recordId` is set.',
  ),
}));

/**
 * 2. Dashboard Navigation Item
 * Navigates to a specific dashboard.
 */
export const DashboardNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('dashboard'),
  dashboardName: z.string().describe('Target dashboard name'),
}));

/**
 * 3. Page Navigation Item
 * Navigates to a custom UI page/component.
 */
export const PageNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('page'),
  pageName: z.string().describe('Target custom page component name'),
  params: z.record(z.string(), z.unknown()).optional().describe('Parameters passed to the page context'),
}));

/**
 * 4. URL Navigation Item
 * Navigates to an external or absolute URL.
 */
export const UrlNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('url'),
  url: z.string().describe('Target external URL'),
  target: z.enum(['_self', '_blank']).default('_self').describe('Link target window'),
}));

/**
 * 5. Report Navigation Item
 * Navigates to a specific report.
 */
export const ReportNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('report'),
  reportName: z.string().describe('Target report name'),
}));

/**
 * 6. Action Navigation Item
 * Triggers an action (e.g. opening a flow, running a script, or launching a screen action).
 */
export const ActionNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('action'),
  actionDef: z.object({
    actionName: z.string().describe('Action machine name to execute'),
    params: z.record(z.string(), z.unknown()).optional().describe('Parameters passed to the action'),
  }).describe('Action definition to execute when clicked'),
}));

/**
 * 7. Component Navigation Item
 * Navigates to a built-in front-end component registered in the runtime's
 * `ComponentRegistry` (e.g. `metadata:directory`, `metadata:resource`,
 * `setup:permission_matrix`). Unlike `page` (which resolves a user-defined
 * Page metadata record) and `url` (external link), `component` targets
 * a first-party UI shipped with the platform — typically admin/setup
 * surfaces that have no row in any data store.
 *
 * `params` are passed verbatim to the component as React props, so the
 * same component (e.g. `metadata:resource`) can be reused across many
 * nav entries with different `type` parameters.
 *
 * @example
 * ```ts
 * { id: 'nav_objects', type: 'component', label: 'Objects',
 *   componentRef: 'metadata:resource', params: { type: 'object' } }
 * ```
 */
export const ComponentNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('component'),
  componentRef: z.string().describe('Component registry key (e.g. "metadata:directory")'),
  params: z.record(z.string(), z.unknown()).optional().describe('Props passed to the component'),
}));

/**
 * 8. Group Navigation Item
 * A container for child navigation items (Sub-menu).
 * Does not perform navigation itself.
 */
export const GroupNavItemSchema = lazySchema(() => BaseNavItemSchema.extend({
  type: z.literal('group'),
  expanded: z.boolean().default(false).describe('Default expansion state in sidebar'),
  // children property is added in the recursive definition below
}));

/**
 * Recursive Union of all navigation item types.
 * Allows constructing an unlimited-depth navigation tree.
 */
export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => 
  z.union([
    ObjectNavItemSchema.extend({
      children: z.array(NavigationItemSchema).optional().describe('Child navigation items (e.g. specific views)'),
    }),
    DashboardNavItemSchema,
    PageNavItemSchema,
    UrlNavItemSchema,
    ReportNavItemSchema,
    ActionNavItemSchema,
    ComponentNavItemSchema,
    GroupNavItemSchema.extend({
      children: z.array(NavigationItemSchema).describe('Child navigation items'),
    })
  ])
);

/**
 * App Branding Configuration
 * Allows configuring the look and feel of the specific app.
 */
export const AppBrandingSchema = lazySchema(() => z.object({
  primaryColor: z.string().optional().describe('Primary theme color hex code'),
  logo: z.string().optional().describe('Custom logo URL for this app'),
  favicon: z.string().optional().describe('Custom favicon URL for this app'),
}));

/**
 * Navigation Area Schema
 * 
 * A logical grouping (zone/section) of navigation items, similar to Salesforce "App Areas"
 * or Dynamics 365 "Site Map Areas". Each area represents a business domain (e.g. Sales, Service, Settings)
 * and contains its own independent navigation tree.
 * 
 * Areas allow large applications to partition navigation by business function while
 * keeping a single AppSchema definition. The runtime may render areas as top-level tabs,
 * sidebar sections, or a switchable navigation context.
 * 
 * @example
 * ```ts
 * const salesArea: NavigationArea = {
 *   id: 'area_sales',
 *   label: 'Sales',
 *   icon: 'briefcase',
 *   order: 1,
 *   navigation: [
 *     { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
 *     { id: 'nav_opportunities', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
 *   ],
 * };
 * ```
 */
export const NavigationAreaSchema = lazySchema(() => z.object({
  /** Unique area identifier */
  id: SnakeCaseIdentifierSchema.describe('Unique area identifier (lowercase snake_case)'),

  /** Display label */
  label: I18nLabelSchema.describe('Area display label'),

  /** Icon name (Lucide) */
  icon: z.string().optional().describe('Area icon name'),

  /** Sort order among areas (lower = first) */
  order: z.number().optional().describe('Sort order among areas (lower = first)'),

  /** Area description */
  description: I18nLabelSchema.optional().describe('Area description'),

  /** 
   * Visibility condition.
   * Formula expression returning boolean.
   */
  visible: ExpressionInputSchema.optional().describe('Visibility predicate (CEL) for this area.'),

  /** Permissions required to access this area */
  requiredPermissions: z.array(z.string()).optional().describe('Permissions required to access this area'),

  /** Navigation items within this area */
  navigation: z.array(NavigationItemSchema).describe('Navigation items within this area'),
}));

/**
 * Schema for Applications (Apps).
 * A logical container for business functionality (e.g., "Sales CRM", "HR Portal").
 * 
 * **NAMING CONVENTION:**
 * App names are used in URLs and routing and must be lowercase snake_case.
 * Prefix with 'app_' is recommended for clarity.
 * 
 * @example Good app names
 * - 'app_crm'
 * - 'app_finance'
 * - 'app_portal'
 * - 'sales_app'
 * 
 * @example Bad app names (will be rejected)
 * - 'CRM' (uppercase)
 * - 'FinanceApp' (mixed case)
 * - 'Sales App' (spaces)
 */
/**
 * App Configuration Schema
 * Defines a business application container, including its navigation, branding, and permissions.
 * 
 * The App is the top-level navigation shell. The `navigation[]` field holds the complete
 * sidebar tree with unlimited nesting depth via `type: 'group'` items. Pages are referenced
 * by name via `type: 'page'` items and defined independently.
 * 
 * @example CRM App with nested navigation tree
 * {
 *   name: "crm",
 *   label: "Sales CRM",
 *   icon: "briefcase",
 *   navigation: [
 *     { type: "group", id: "grp_sales", label: "Sales Cloud", expanded: true, children: [
 *       { type: "page", id: "nav_pipeline", label: "Pipeline", pageName: "page_pipeline" },
 *       { type: "page", id: "nav_accounts", label: "Accounts", pageName: "page_accounts" },
 *     ]},
 *     { type: "page", id: "nav_settings", label: "Settings", pageName: "admin_settings" },
 *   ]
 * }
 */
export const AppSchema = lazySchema(() => z.object({
  /** Machine name (id) */
  name: SnakeCaseIdentifierSchema.describe('App unique machine name (lowercase snake_case)'),
  
  /** Display label */
  label: I18nLabelSchema.describe('App display label'),

  /** App version */
  version: z.string().optional().describe('App version'),
  
  /** Description */
  description: I18nLabelSchema.optional().describe('App description'),
  
  /** Icon name (Lucide) */
  icon: z.string().optional().describe('App icon used in the App Launcher'),
  
  /** Branding/Theming Configuration */
  branding: AppBrandingSchema.optional().describe('App-specific branding'),
  
  /** Application status */
  active: z.boolean().optional().default(true).describe('Whether the app is enabled'),

  /** Is this the default app for new users? */
  isDefault: z.boolean().optional().default(false).describe('Is default app'),

  /**
   * Hide this app from the top-level App Switcher.
   *
   * Hidden apps stay fully routable and permission-checked — they just
   * don't appear in the apps dropdown. The shell is expected to surface
   * them through the avatar / user dropdown instead, so this is the
   * right knob for personal-settings-style apps ("Account") that would
   * feel out of place next to business apps (CRM, HR, Setup).
   *
   * Mirrors GitHub Settings / Google account chip / Salesforce
   * "Personal Settings" — visible to every user, but reached from the
   * avatar rather than the app launcher.
   */
  hidden: z.boolean().optional()
    .describe('Hide from the App Switcher; the shell surfaces hidden apps via the avatar menu instead'),
  
  /** 
   * Full Navigation Tree — supports unlimited nesting depth.
   * Pages are referenced by name via `type: 'page'` items.
   * Groups can contain other groups for arbitrary sidebar depth.
   * 
   * For simple apps, use `navigation` directly.
   * For enterprise apps with multiple business domains, use `areas` instead.
   */
  navigation: z.array(NavigationItemSchema).optional()
    .describe('Full navigation tree for the app sidebar'),

  /**
   * Navigation Areas — partitions navigation by business domain.
   * Each area defines an independent navigation tree (e.g. Sales, Service, Settings).
   * When areas are defined, they take precedence over the top-level `navigation` array.
   * 
   * @example
   * ```ts
   * areas: [
   *   { id: 'area_sales', label: 'Sales', icon: 'briefcase', order: 1, navigation: [...] },
   *   { id: 'area_service', label: 'Service', icon: 'headset', order: 2, navigation: [...] },
   * ]
   * ```
   */
  areas: z.array(NavigationAreaSchema).optional()
    .describe('Navigation areas for partitioning navigation by business domain'),
  
  /** 
   * App-level Home Page Override
   * ID of the navigation item to act as the landing page.
   * If not set, usually defaults to the first navigation item.
   */
  homePageId: z.string().optional().describe('ID of the navigation item to serve as landing page'),

  /** 
   * Access Control
   * List of permissions required to access this app.
   * Modern replacement for role/profile based assignment.
   * Example: ["app.access.crm"]
   */
  requiredPermissions: z.array(z.string()).optional().describe('Permissions required to access this app'),
  
  /** 
   * Package Components (For config file convenience)
   * In a real monorepo these might be auto-discovered, but here we allow explicit registration.
   */
  objects: z.array(z.unknown()).optional().describe('Objects belonging to this app'),
  apis: z.array(z.unknown()).optional().describe('Custom APIs belonging to this app'),

  /** Sharing configuration for public access */
  sharing: SharingConfigSchema.optional().describe('Public sharing configuration'),

  /** Embed configuration for iframe embedding */
  embed: EmbedConfigSchema.optional().describe('Iframe embedding configuration'),

  /** Mobile navigation mode */
  mobileNavigation: z.object({
    mode: z.enum(['drawer', 'bottom_nav', 'hamburger']).default('drawer')
      .describe('Mobile navigation mode: drawer sidebar, bottom navigation bar, or hamburger menu'),
    bottomNavItems: z.array(z.string()).optional()
      .describe('Navigation item IDs to show in bottom nav (max 5)'),
  }).optional().describe('Mobile-specific navigation configuration'),

  /**
   * Default AI Copilot for this app.
   *
   * When set, the ambient chat endpoint (`POST /api/v1/ai/chat` with
   * `context.appName`) auto-resolves to this agent without the user
   * having to pick from a list. The agent's `skills[]` are loaded
   * from the SkillRegistry and exposed to the LLM.
   *
   * Mirrors the Salesforce Agentforce / ServiceNow Now Assist pattern
   * where each application surface has one ambient copilot.
   *
   * @example
   * ```ts
   * defineApp({ name: 'crm', defaultAgent: 'sales_copilot', ... })
   * ```
   */
  defaultAgent: SnakeCaseIdentifierSchema.optional()
    .describe('Name of the default AI agent for this app (used by the ambient chat endpoint)'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes for the application'),
}));

/**
 * App Factory Helper
 */
export const App = {
  create: (config: z.input<typeof AppSchema>): App => AppSchema.parse(config),
} as const;

/**
 * Type-safe factory for creating application definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example CRM App with nested navigation tree
 * ```ts
 * const crmApp = defineApp({
 *   name: 'crm',
 *   label: 'Sales CRM',
 *   navigation: [
 *     { id: 'grp_sales', type: 'group', label: 'Sales Cloud', expanded: true, children: [
 *       { id: 'nav_pipeline', type: 'page', label: 'Pipeline', pageName: 'page_pipeline' },
 *       { id: 'nav_accounts', type: 'page', label: 'Accounts', pageName: 'page_accounts' },
 *     ]},
 *     { id: 'nav_settings', type: 'page', label: 'Settings', pageName: 'admin_settings' },
 *   ],
 * });
 * ```
 */
export function defineApp(config: z.input<typeof AppSchema>): App {
  return AppSchema.parse(config);
}

// Main Types
export type App = z.infer<typeof AppSchema>;
export type AppInput = z.input<typeof AppSchema>;
export type AppBranding = z.infer<typeof AppBrandingSchema>;
export type NavigationItem = z.infer<typeof NavigationItemSchema>;
export type NavigationArea = z.infer<typeof NavigationAreaSchema>;

// Discriminated Item Types (Helper exports)
export type ObjectNavItem = z.infer<typeof ObjectNavItemSchema>;
export type DashboardNavItem = z.infer<typeof DashboardNavItemSchema>;
export type PageNavItem = z.infer<typeof PageNavItemSchema>;
export type UrlNavItem = z.infer<typeof UrlNavItemSchema>;
export type ReportNavItem = z.infer<typeof ReportNavItemSchema>;
export type ActionNavItem = z.infer<typeof ActionNavItemSchema>;
export type ComponentNavItem = z.infer<typeof ComponentNavItemSchema>;
export type GroupNavItem = z.infer<typeof GroupNavItemSchema> & { children: NavigationItem[] };
