// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module ui/portal
 *
 * Portal Protocol — Metadata-driven external-user UI projection.
 *
 * A Portal is **not** a new application or permission model. It is a
 * declarative projection of the existing app / view / action surface,
 * scoped to a route prefix, a set of admitted positions, and an optional
 * anonymous entry surface.
 *
 * Five invariants this schema preserves:
 *   1. Zero business code — layout is an enum + plugin id; theme is tokens;
 *      navigation is references to existing metadata.
 *   2. Data plane is untouched — portal cannot declare objects, fields,
 *      flows, or permissions. Data API (`/api/v1/data/...`) is unaware of
 *      portals.
 *   3. Portal ≠ permission boundary. The permission model is (permission
 *      sets distributed via positions, ADR-0090). Portals only narrow the
 *      UI projection; hiding a view in `navigation` is UX, not security.
 *   4. Stackable — the same user/position can be admitted by multiple
 *      portals. Routing or a picker decides which one is rendered.
 *   5. Template-first — a template author ships `customer.portal.ts` and
 *      the platform guarantees the rendering shell.
 *
 * Architectural reach (consumer guidance, not part of the schema):
 *   - Dispatcher / HonoServer: at boot, enumerate portals and register
 *     `/<routePrefix>/*` route families with a per-portal auth scope.
 *   - Auth middleware: admit the request if one of the caller's positions
 *     ∈ `portal.positions`, or it matches `anonymousEntry.routes[*]`.
 *   - objectui LayoutDispatcher: select shell from `layout`.
 *   - objectui NavigationBuilder: render `navigation` (not the all-apps
 *     grid).
 *   - objectui ThemeProvider: inject `theme` as CSS variables.
 *
 * See framework issue
 *   https://github.com/objectstack-ai/framework/issues/1294
 * for the design rationale.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema } from './i18n.zod';

// ---------------------------------------------------------------------------
// Theme tokens (portal-local; intentionally narrower than AppBranding to keep
// portal metadata declarative and platform-renderable without custom CSS)
// ---------------------------------------------------------------------------

export const PortalThemeSchema = lazySchema(() => z.object({
  primaryColor: z.string().optional()
    .describe('Primary brand color (hex, rgb, hsl). Mapped to --portal-primary.'),
  accentColor: z.string().optional()
    .describe('Accent color used for highlights and CTAs.'),
  backgroundColor: z.string().optional()
    .describe('Page background color.'),
  surfaceColor: z.string().optional()
    .describe('Card / surface background color.'),
  textColor: z.string().optional()
    .describe('Primary text color.'),
  logoUrl: z.string().optional()
    .describe('Absolute or relative URL to the portal header logo (SVG or PNG).'),
  faviconUrl: z.string().optional()
    .describe('Absolute or relative URL to the portal favicon.'),
  fontFamily: z.string().optional()
    .describe('CSS font-family stack for the portal.'),
  customCss: z.string().optional()
    .describe('OPTIONAL escape hatch: raw CSS appended last. Discouraged; prefer tokens.'),
}));

// ---------------------------------------------------------------------------
// Navigation — references to existing metadata. Discriminated union mirrors
// app.zod.ts shape but is intentionally a much smaller surface: portals
// expose a flat list of entry points, not a deep group tree.
// ---------------------------------------------------------------------------

const BasePortalNavItemSchema = z.object({
  id: SnakeCaseIdentifierSchema
    .describe('Unique identifier for this portal nav item (lowercase snake_case).'),
  label: I18nLabelSchema.describe('Display label.'),
  icon: z.string().optional().describe('Icon name (Lucide).'),
  order: z.number().optional().describe('Sort order; lower appears first.'),
  badge: z.union([z.string(), z.number()]).optional()
    .describe('Optional badge (e.g. unread count).'),
});

export const PortalViewNavItemSchema = BasePortalNavItemSchema.extend({
  type: z.literal('view'),
  /** Fully-qualified view reference: `<object_name>.<view_id>` */
  viewRef: z.string().describe('Reference to an existing view, e.g. "helpdesk_ticket.list.my_tickets".'),
});

export const PortalActionNavItemSchema = BasePortalNavItemSchema.extend({
  type: z.literal('action'),
  /** Fully-qualified action reference: `<object_name>.<action_id>` */
  actionRef: z.string().describe('Reference to an existing action, e.g. "helpdesk_ticket.create".'),
});

export const PortalDashboardNavItemSchema = BasePortalNavItemSchema.extend({
  type: z.literal('dashboard'),
  dashboardName: SnakeCaseIdentifierSchema.describe('Existing dashboard id.'),
});

export const PortalUrlNavItemSchema = BasePortalNavItemSchema.extend({
  type: z.literal('url'),
  url: z.string().describe('Absolute or root-relative URL.'),
  target: z.enum(['_self', '_blank']).optional().default('_self'),
});

export const PortalNavItemSchema = z.discriminatedUnion('type', [
  PortalViewNavItemSchema,
  PortalActionNavItemSchema,
  PortalDashboardNavItemSchema,
  PortalUrlNavItemSchema,
]);

// ---------------------------------------------------------------------------
// Anonymous entry — declarative, with mandatory rate-limit + captcha hooks
// for any unauthenticated mutation. Read-only views (e.g. public KB) only
// need a rate-limit budget.
// ---------------------------------------------------------------------------

export const PortalRateLimitSchema = lazySchema(() => z.object({
  /** Token-bucket rule string, e.g. "5/hour/ip" or "100/day/tenant". */
  rule: z.string().describe('Rate-limit rule string, e.g. "5/hour/ip", "100/day/tenant".'),
  /** Scope key controlled by the runtime. */
  scope: z.enum(['ip', 'tenant', 'route']).default('ip')
    .describe('Counter scope. "ip" buckets per requester; "tenant" per portal owner; "route" global per route.'),
}));

export const PortalAnonymousRouteSchema = lazySchema(() => z.object({
  /** Portal-relative path, must begin with `/`. */
  path: z.string().describe('Path within the portal, e.g. "/submit" or "/kb".'),
  /** Exactly one of these must be set. */
  viewRef: z.string().optional()
    .describe('Reference to a public view (read-only).'),
  actionRef: z.string().optional()
    .describe('Reference to an action to perform anonymously (mutation).'),
  rateLimit: PortalRateLimitSchema.optional()
    .describe('Rate-limit for anonymous traffic on this route.'),
  captcha: z.boolean().optional().default(false)
    .describe('Require CAPTCHA / proof-of-work challenge before invoking.'),
  /**
   * For action routes that need a deferred identity bind (e.g. anonymous
   * ticket submission → magic-link verification of the supplied email).
   * The runtime captures the input field, sends a magic link, and on
   * verification re-attributes the created record to the new user.
   */
  bindIdentityFromField: z.string().optional()
    .describe('Field name on the action input to use for magic-link identity binding (e.g. "customer_email").'),
}));

export const PortalAnonymousEntrySchema = lazySchema(() => z.object({
  routes: z.array(PortalAnonymousRouteSchema)
    .describe('List of anonymous-accessible routes.'),
  /** Default rate-limit applied when a route does not specify one. */
  defaultRateLimit: PortalRateLimitSchema.optional(),
}));

// ---------------------------------------------------------------------------
// SEO + locale + auth modes
// ---------------------------------------------------------------------------

export const PortalSeoSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('Default <title>.'),
  description: z.string().optional().describe('Default <meta name="description">.'),
  openGraphImage: z.string().optional().describe('Default og:image URL.'),
  robots: z.enum(['index', 'noindex']).optional().default('index'),
}));

export const PortalAuthModeSchema = lazySchema(() => z.union([
  z.literal('authenticated'),
  z.literal('magic-link'),
  z.literal('anonymous'),
  // SSO provider, e.g. "sso:google", "sso:azure-ad", "sso:saml:<idp-id>".
  z.string().regex(/^sso:[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)?$/i,
    'SSO mode must be "sso:<provider>" or "sso:<protocol>:<idp-id>"'),
]));

export const PortalLayoutSchema = lazySchema(() => z.union([
  z.literal('console'),
  z.literal('minimal'),
  z.literal('embedded'),
  // Plugin shell: "custom:<plugin-id>" or "custom:<plugin-id>/<layout-id>".
  z.string().regex(/^custom:[a-z][a-z0-9_-]*(?:\/[a-z0-9_-]+)?$/i,
    'Custom layout must be "custom:<plugin-id>" or "custom:<plugin-id>/<layout-id>"'),
]));

// ---------------------------------------------------------------------------
// Portal — top-level metadata kind
// ---------------------------------------------------------------------------

export const PortalSchema = lazySchema(() => z.object({
  /** Discriminator for the metadata registry. */
  kind: z.literal('portal').describe('Metadata kind discriminator.'),

  /** Machine name (id). Unique per tenant. */
  id: SnakeCaseIdentifierSchema
    .describe('Portal unique machine name (lowercase snake_case).'),

  /** Display label, i18n. */
  label: I18nLabelSchema.describe('Portal display label.'),

  /** Optional description (i18n). */
  description: I18nLabelSchema.optional(),

  // ---------------- Routing ----------------

  /**
   * Root path the portal is mounted at. MUST be absolute and start with `/`.
   * Multiple portals cannot share the same `routePrefix` within a tenant.
   * Example: "/portal/helpdesk".
   */
  routePrefix: z.string()
    .regex(/^\/[a-z0-9/_-]*$/i, 'routePrefix must start with "/" and be url-safe')
    .describe('Root URL path for the portal (must start with "/").'),

  /**
   * Optional vanity domain. When set, the platform serves the portal on
   * this hostname in addition to (or instead of) `routePrefix` on the
   * default domain. Subject to TLS provisioning and DNS verification.
   */
  domain: z.string().optional()
    .describe('Optional vanity domain (e.g. "support.acme.com").'),

  // ---------------- Shell ----------------

  layout: PortalLayoutSchema.default('minimal')
    .describe('Shell layout for the portal.'),

  theme: PortalThemeSchema.optional().describe('Theme tokens.'),

  /**
   * Locale resolution. "auto" → use Accept-Language; otherwise force a
   * specific locale (e.g. "en", "zh-CN").
   */
  locale: z.union([z.literal('auto'), z.string()]).optional().default('auto')
    .describe('Locale resolution strategy.'),

  /** SEO metadata defaults for unauthenticated pages. */
  seo: PortalSeoSchema.optional(),

  // ---------------- Auth ----------------

  authMode: PortalAuthModeSchema.default('authenticated')
    .describe('Authentication mode for the portal.'),

  /**
   * Positions admitted to the portal (ADR-0090 — formerly `profiles`; the
   * Profile concept was removed by D2). A user is allowed in iff they hold
   * at least one of the listed positions. Use the built-in `guest` position
   * for anonymous-only portals (D9). **This is a UI gate, not the source of
   * truth — the data layer still enforces permission sets + sharing on
   * every API call.**
   */
  positions: z.array(SnakeCaseIdentifierSchema)
    .min(1, "A portal must admit at least one position (use the built-in 'guest' position for anonymous-only portals).")
    .describe('Positions admitted to the portal.'),

  /**
   * Tombstone for the removed `profiles` key (ADR-0090 D2): reject loudly
   * with the FROM → TO prescription instead of silently stripping — a
   * silently-dropped admission gate is exactly the class of authoring error
   * the vocabulary freeze exists to prevent.
   */
  profiles: z
    .unknown()
    .optional()
    .superRefine((v, ctx) => {
      if (v !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "'profiles' was removed (ADR-0090 D2 — the Profile concept no longer exists). " +
            "Declare `positions` instead: the flat distribution groups admitted to this portal " +
            "(use the built-in 'guest' position for anonymous-only portals).",
        });
      }
    }),

  /**
   * Anonymous entry surface — declarative routes that can be hit without
   * a session. The runtime impersonates a tenant-local `system.anonymous`
   * principal, applies the route's rate-limit + captcha, then runs the
   * referenced view/action.
   */
  anonymousEntry: PortalAnonymousEntrySchema.optional(),

  // ---------------- Navigation ----------------

  navigation: z.array(PortalNavItemSchema)
    .describe('Flat list of portal entry points (references to existing metadata).'),

  /**
   * Optional default route. If omitted, the runtime picks the first
   * `navigation` entry.
   */
  defaultRoute: z.object({
    viewRef: z.string().optional(),
    actionRef: z.string().optional(),
    dashboardName: SnakeCaseIdentifierSchema.optional(),
  }).optional().describe('Landing surface when the user hits the portal root.'),

  // ---------------- Embedding ----------------

  /**
   * Whether the portal may be rendered inside an `<iframe>`. Controls
   * `X-Frame-Options` / `frame-ancestors` CSP headers.
   */
  embeddable: z.boolean().optional().default(false),

  /**
   * Allowed embed origins (CSP `frame-ancestors`). Ignored when
   * `embeddable: false`.
   */
  allowedEmbedOrigins: z.array(z.string()).optional(),

  /** Whether the portal is active. */
  active: z.boolean().optional().default(true),
}).describe('Portal projection. [EXPERIMENTAL — not enforced] PortalSchema is not registered as an authorable metadata type; no dispatcher route family, auth scope, LayoutDispatcher, NavigationBuilder or ThemeProvider consumes it yet. The entire schema is a forward-looking design (framework #1294); authoring a portal today is a no-op (liveness audit #1878/#1893).'));

// ---------------------------------------------------------------------------
// Factory + types
// ---------------------------------------------------------------------------

export const Portal = {
  create: (config: z.input<typeof PortalSchema>): Portal => PortalSchema.parse(config),
} as const;

export function definePortal(config: z.input<typeof PortalSchema>): Portal {
  return PortalSchema.parse(config);
}

export type Portal = z.infer<typeof PortalSchema>;
export type PortalInput = z.input<typeof PortalSchema>;
export type PortalTheme = z.infer<typeof PortalThemeSchema>;
export type PortalNavItem = z.infer<typeof PortalNavItemSchema>;
export type PortalViewNavItem = z.infer<typeof PortalViewNavItemSchema>;
export type PortalActionNavItem = z.infer<typeof PortalActionNavItemSchema>;
export type PortalDashboardNavItem = z.infer<typeof PortalDashboardNavItemSchema>;
export type PortalUrlNavItem = z.infer<typeof PortalUrlNavItemSchema>;
export type PortalAnonymousEntry = z.infer<typeof PortalAnonymousEntrySchema>;
export type PortalAnonymousRoute = z.infer<typeof PortalAnonymousRouteSchema>;
export type PortalRateLimit = z.infer<typeof PortalRateLimitSchema>;
export type PortalSeo = z.infer<typeof PortalSeoSchema>;
export type PortalAuthMode = z.infer<typeof PortalAuthModeSchema>;
export type PortalLayout = z.infer<typeof PortalLayoutSchema>;
