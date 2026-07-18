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
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ProtectionSchema } from '../shared/protection.zod';
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

  /** Visual variant for the badge (consumed by objectui NavigationRenderer) */
  badgeVariant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional().describe('Visual variant of the nav badge. Declared to match the objectui NavigationRenderer read (inverse-drift fix, liveness audit #1878/#1891/#1894).'),

  /** 
   * Visibility condition. 
   * Formula expression returning boolean. 
   * e.g. "user.is_admin || user.department == 'sales'"
   */
  visible: ExpressionInputSchema.optional().describe('Visibility predicate (CEL). e.g. P`\'org_admin\' in current_user.positions`'),

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
 *
 * @example Parameterized slice on the bare data surface (objectui ADR-0055)
 * ```ts
 * { id: 'nav_my_open', type: 'object', label: 'My Open Tickets',
 *   objectName: 'ticket', filters: { owner_id: '{current_user_id}', status: 'open' } }
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
  /**
   * URL filter conditions — the entry targets the parameterized bare data
   * surface (`/:objectName/data`, objectui ADR-0055) with each entry
   * serialized as a `filter[<field>]=<value>` search param (equality
   * semantics), instead of anchoring to a saved view. Use for one-off /
   * parameterized slices (dashboard drill-throughs, "assigned to me"
   * links); a slice worth curating and reusing belongs in a named view
   * via `viewName`. Values support the same template variables as
   * `recordId`. Precedence: `recordId` → `filters` → `viewName`.
   *
   * Mutually exclusive with `recordId` / `viewName` — enforced by
   * {@link NavigationItemSchema} (see `objectNavTargetExclusivity`) so the
   * ambiguous combination is unrepresentable rather than silently resolved
   * by precedence.
   */
  filters: z.record(z.string(), z.string()).optional().describe(
    'URL filter conditions — targets the /:objectName/data bare surface via filter[<field>]=<value> params instead of a saved view. Values support template vars {current_user_id}, {current_org_id}. Mutually exclusive with recordId/viewName.',
  ),
}));

/**
 * Correct-by-construction guard (ADR-0053 philosophy): `filters` combined
 * with `recordId` or `viewName` is an authoring ambiguity — runtime
 * precedence would silently ignore one of them (a stale `recordId` hijacks
 * a configured `filters` slice). Reject it at validation with the fix in
 * the message. The legacy `recordId` + `viewName` combination stays
 * tolerated: it predates this guard and is documented as "viewName is
 * ignored when recordId is set".
 */
const objectNavTargetExclusivity = (
  item: { filters?: unknown; recordId?: unknown; viewName?: unknown },
  ctx: z.RefinementCtx,
): void => {
  if (item.filters && (item.recordId || item.viewName)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['filters'],
      message:
        '`filters` cannot be combined with `recordId` or `viewName` — pick ONE landing: '
        + 'recordId (record deep-link), filters (/data slice), or viewName (named view). '
        + 'Remove the extra field(s); runtime precedence would silently ignore them.',
    });
  }
};

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
 * 9. Separator Navigation Item
 * A visual divider in the navigation list. Renders no target; declared to
 * match the objectui renderer's `item.type === 'separator'` branch
 * (inverse-drift fix, liveness audit #1878/#1891/#1894).
 */
const SeparatorNavItemSchema = lazySchema(() => z.object({
  type: z.literal('separator'),
  id: SnakeCaseIdentifierSchema.optional().describe('Optional id for the separator'),
  order: z.number().optional().describe('Sort order within the same level (lower = first)'),
}));

/**
 * Recursive Union of all navigation item types.
 * Allows constructing an unlimited-depth navigation tree.
 */
export const NavigationItemSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    ObjectNavItemSchema.extend({
      children: z.array(NavigationItemSchema).optional().describe('Child navigation items (e.g. specific views)'),
    }).superRefine(objectNavTargetExclusivity),
    DashboardNavItemSchema,
    PageNavItemSchema,
    UrlNavItemSchema,
    ReportNavItemSchema,
    ActionNavItemSchema,
    ComponentNavItemSchema,
    SeparatorNavItemSchema,
    GroupNavItemSchema.extend({
      children: z.array(NavigationItemSchema).describe('Child navigation items'),
    })
  ])
);

/**
 * Navigation Contribution (ADR-0029 D7)
 *
 * Lets a package inject navigation items into an app it does **not** own —
 * the UI-layer analog of object `objectExtensions`. A capability plugin
 * contributes its menu entries into a shared admin app (e.g. `setup`) so the
 * app can be a thin "shell + group anchors" while each plugin ships the menu
 * for the objects it owns.
 *
 * The runtime merges all contributions into the owning app's `navigation`
 * tree by **target group id + priority** (lower priority applied first,
 * mirroring object extender ordering). When `group` is omitted the items are
 * appended at the app's top level. Contributed items keep the normal nav
 * gating fields (`requiresObject` / `requiredPermissions` / `visible`), so an
 * uninstalled capability simply contributes nothing and its slot stays empty.
 *
 * @example
 * {
 *   app: 'setup',
 *   group: 'group_integrations',
 *   priority: 100,
 *   items: [
 *     { id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook', requiresObject: 'sys_webhook' },
 *   ],
 * }
 */
export const NavigationContributionSchema = lazySchema(() => z.object({
  app: SnakeCaseIdentifierSchema.describe('Target app name to contribute navigation into (e.g. "setup")'),
  group: SnakeCaseIdentifierSchema.optional().describe('Target group nav-item id to append into (e.g. "group_integrations"); omit to append at the app top level'),
  priority: z.number().int().min(0).default(200).describe('Merge priority within the target group — lower applied first (matches object extender priority)'),
  items: z.array(NavigationItemSchema).describe('Navigation items contributed into the target app/group'),
}).describe('A navigation contribution: a package injecting nav items into an app it does not own (ADR-0029 D7)'));
export type NavigationContribution = z.infer<typeof NavigationContributionSchema>;

/**
 * App Branding Configuration
 * Allows configuring the look and feel of the specific app.
 */
export const AppBrandingSchema = lazySchema(() => z.object({
  primaryColor: z.string().optional().describe('Primary theme color hex code'),
  accentColor: z.string().optional().describe('Accent color hex code (highlights, active states). Declared to match the objectui ConsoleLayout read of branding.accentColor (inverse-drift fix, liveness audit #1878/#1891/#1894).'),
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
 * App Context Selector Schema
 *
 * Declares a sidebar-level "scope" dropdown (e.g. a Package filter, an
 * Environment switcher, a Locale picker) whose **current value is exposed
 * as a navigation template variable** named after `id`.
 *
 * This is the metadata-driven way to add a control at the top of the
 * navigation that transparently scopes every child navigation item —
 * without wiring the value into each item by hand. The shell:
 *   1. Renders the dropdown (options pulled from `optionsSource.endpoint`).
 *   2. Holds the selected value (persisted per `persist`).
 *   3. Substitutes `{<id>}` into any nav item's `params` / `recordId`
 *      exactly like the built-in `{current_user_id}` / `{current_org_id}`
 *      variables (see `ObjectNavItem.recordId`).
 *
 * @example Package filter for the Studio workbench
 * ```ts
 * contextSelectors: [{
 *   id: 'active_package',
 *   label: 'Package',
 *   icon: 'package',
 *   optionsSource: {
 *     endpoint: '/api/v1/packages',
 *     valueKey: 'manifest.id',
 *     labelKey: 'manifest.name',
 *     // Only offer third-party / custom (project-scoped) packages;
 *     // hide the platform's own system/cloud kernel packages.
 *     filter: [{ key: 'manifest.scope', op: 'nin', value: ['system', 'cloud'] }],
 *   },
 * }]
 * // …then in nav items:
 * { id: 'nav_objects', type: 'component', componentRef: 'metadata:resource',
 *   params: { type: 'object', package: '{active_package}' } }
 * ```
 */
export const AppContextSelectorSchema = lazySchema(() => z.object({
  /**
   * Identifier — also the template-variable name the selected value is
   * exposed under. Reference it in nav items as `{<id>}`
   * (e.g. `id: 'active_package'` → `{active_package}`).
   */
  id: SnakeCaseIdentifierSchema.describe('Selector id; selected value is exposed as the nav template var {<id>}'),

  /** Display label for the dropdown. */
  label: I18nLabelSchema.describe('Dropdown label'),

  /** Icon name (Lucide). */
  icon: z.string().optional().describe('Icon name'),

  /**
   * Where the dropdown options come from. The shell fetches `endpoint`
   * and maps each row to `{ value: row[valueKey], label: row[labelKey] }`.
   * Re-uses existing REST surfaces (e.g. `/api/v1/packages`) so no
   * bespoke option API is required.
   */
  optionsSource: z.object({
    endpoint: z.string().describe('REST endpoint returning the option rows (e.g. /api/v1/packages)'),
    valueKey: z.string().default('id').describe('Row property used as the option value (dotted path allowed, e.g. "manifest.id")'),
    labelKey: z.string().default('name').describe('Row property used as the option label (dotted path allowed, e.g. "manifest.name")'),
    /**
     * Optional predicates applied to each fetched row before it becomes
     * an option. All predicates must pass (logical AND). Keys are dotted
     * paths so nested fields (e.g. `manifest.scope`) can be reached.
     *
     * This keeps shared REST surfaces (e.g. `/api/v1/packages`) generic
     * while letting an individual selector narrow the list. For example,
     * the Studio package scope hides platform/kernel packages so only
     * `project`-scoped (third-party / custom) packages are selectable —
     * the scope dropdown is a developer affordance, not a place to
     * surface the platform's own internal `system`/`cloud` packages:
     *
     * ```ts
     * filter: [{ key: 'manifest.scope', op: 'nin', value: ['system', 'cloud'] }]
     * ```
     */
    filter: z.array(z.object({
      key: z.string().describe('Dotted path on each row to compare (e.g. "manifest.scope")'),
      op: z.enum(['eq', 'ne', 'in', 'nin']).default('eq')
        .describe('Comparison operator: eq | ne | in | nin'),
      value: z.union([z.string(), z.array(z.string())])
        .describe('Comparison value (string for eq/ne, string[] for in/nin)'),
    })).optional().describe('Predicates (AND) each option row must satisfy'),
  }).describe('Option data source'),

  /** Whether to prepend an "All" option that clears the scope. */
  includeAll: z.boolean().default(true).describe('Prepend an "All" option that clears the scope'),

  /** Value emitted when "All" is selected (empty string = no filter). */
  allValue: z.string().default('').describe('Template value when "All" is selected (empty = no filter)'),

  /** How the selection is persisted across navigation. */
  persist: z.enum(['query', 'session', 'none']).default('query')
    .describe('Persist selection via URL query, sessionStorage, or not at all'),

  /** Where the dropdown is rendered. */
  placement: z.enum(['sidebar_header', 'topbar']).default('sidebar_header')
    .describe('Render location in the app chrome'),
}));

export type AppContextSelector = z.infer<typeof AppContextSelectorSchema>;

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
   * App-level context selectors — sidebar/topbar "scope" dropdowns whose
   * selected value is injected into navigation items as a template
   * variable (`{<id>}`). Use to add a Package / Environment / Locale
   * filter that transparently scopes every child nav item. See
   * {@link AppContextSelectorSchema}.
   */
  contextSelectors: z.array(AppContextSelectorSchema).optional()
    .describe('App-level scope dropdowns whose value is injected into nav items as {<id>} template vars'),
  
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

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this app.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,
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
