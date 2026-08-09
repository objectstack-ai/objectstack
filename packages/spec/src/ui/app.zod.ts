// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema } from './i18n.zod';
import { retiredKey } from '../shared/retired-key';
import { strictObject, type StrictObjectOptions } from '../shared/strict-object';

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

/*
 * ── Unknown-key strictness (#4001 app step, PR B) ───────────────────────────
 *
 * Every AUTHORING schema in this module is `.strict()`. The app shell is the
 * densest hand-authored surface on the platform — a navigation tree is where
 * an author (or AI) is most likely to write a key from memory — so a silent
 * strip here is the most probable instance of the #3405 trap: the entry
 * renders, just not the way it was declared.
 *
 * The nav-item union is a **discriminated** union on `type`. That is what
 * makes strict readable: a plain `z.union` of strict members answers one
 * unknown key with an `invalid_union` aggregate naming every branch's
 * failure, whereas the discriminated form matches on `type` FIRST and then
 * reports a single `unrecognized_keys` issue against that branch alone —
 * with an exact path through nested `children`. A mistyped `type` gets its
 * own precise "Invalid discriminator value" instead of the same wall.
 * (`view.zod.ts` and `widget.zod.ts` set the in-repo precedent.)
 *
 * Deliberately still OPEN: `PageNavItem.params` / `ComponentNavItem.params`
 * (React props passed verbatim to a component) and `ActionNavItem.actionDef.
 * params` (action arguments) — those are per-target payloads whose contract
 * belongs to the page/component/action, not to the nav item.
 *
 * PR A (#4142) is the precondition: the seven audit-dead App keys became
 * tombstones there, so strictness now guards the real contract rather than
 * dead surface (ADR-0049 enforce-or-remove).
 */

/**
 * Semantic near-misses shared by every nav-item variant.
 *
 * `visibleWhen` is the load-bearing entry, and the same one #3746 found on
 * action params: ADR-0089 made `visibleWhen` the canonical predicate on
 * view/page schemas, so an author who learned it there writes it here — and
 * before this, borrowing it silently REMOVED the entry's visibility gate,
 * rendering a nav item that should have been hidden. A capability gate that
 * fails open is the worst shape of the silent-strip bug.
 */
const NAV_ITEM_ALIASES: Readonly<Record<string, string>> = {
  visiblewhen: 'visible',
  visibleon: 'visible',
  visibility: 'visible',
  hidden: 'visible',
  title: 'label',
  name: 'id',
  sort: 'order',
  sortorder: 'order',
  position: 'order',
  permissions: 'requiredPermissions',
  requiredpermission: 'requiredPermissions',
  requiresobjects: 'requiresObject',
  badgecolor: 'badgeVariant',
  badgestyle: 'badgeVariant',
};

/**
 * The four spellings of "start expanded", which is a CROSS-VARIANT key and not
 * a shared one — so they are assembled per variant below, not listed above.
 *
 * Found by the alias gate: the platform's own Account app declared `defaultOpen`
 * on three groups (never a schema key), so all three shipped COLLAPSED while
 * their author believed they opened by default. The redirect that fixed that is
 * right only where `expanded` exists, i.e. on `group`.
 *
 * They lived in the shared table until #5555 measured the consequence: `expanded`
 * is declared on `group` alone, so on the other eight variants the redirect named
 * a key that variant ALSO rejects — the author fixed the spelling as instructed
 * and was rejected a second time, with no suggestion left (ledger finding 7, from
 * the #4001 campaign built to end exactly that). Below they get the same prose
 * treatment as the six cross-variant payload keys, for the same reason: the key
 * is spelled right, the `type` is wrong, and a bare key name cannot say so.
 *
 * Spelled out as two literal tables rather than derived, because the prose
 * string is contract surface: `alias-integrity.test.ts`'s `PROSE_ALIAS_TARGETS`
 * allowlist matches it exactly, and a reader who greps the message an author
 * reported has to land here.
 */
const NAV_EXPANDED_ALIASES_ON_GROUP: Readonly<Record<string, string>> = {
  defaultopen: 'expanded',
  open: 'expanded',
  collapsed: 'expanded',
  isopen: 'expanded',
};

const NAV_EXPANDED_ALIASES_ELSEWHERE: Readonly<Record<string, string>> = {
  defaultopen: 'type: \'group\' (with expanded)',
  open: 'type: \'group\' (with expanded)',
  collapsed: 'type: \'group\' (with expanded)',
  isopen: 'type: \'group\' (with expanded)',
};

/** Every `type` a navigation item can carry — one strict branch each. */
type NavItemVariant =
  | 'object' | 'dashboard' | 'page' | 'url' | 'report'
  | 'action' | 'component' | 'group' | 'separator';

/**
 * The two variants that ACCEPT `children`.
 *
 * Not on the branch schema itself — {@link NavigationItemSchema} `.extend()`s
 * the recursive `children` onto these two members, and strictness plus the
 * error map ride that extension, so `children` is legal on exactly these two at
 * the door anything actually parses. Two facts follow, and they are the reason
 * this set exists at all:
 *
 * 1. the `children` PRESCRIPTION must not be filed on them — it would be a dead
 *    entry on the extended surface, which `alias-integrity.test.ts` rejects;
 * 2. `children` belongs in their `extraKeys`, so a near-miss (`childs`,
 *    `childrens`) still resolves on the extended surface even though the branch
 *    schema's own `.shape` has no such key.
 *
 * Kept as a two-entry set rather than the nine-entry key transcription this
 * factory used to carry (#5593): everything else the suggestion pool needs is
 * read from each branch's own `.shape`. Getting this set wrong in the dangerous
 * direction — naming a variant whose member does accept `children` — fails the
 * gate rather than shipping a dead entry.
 */
const NAV_VARIANTS_ACCEPTING_CHILDREN: ReadonlySet<NavItemVariant> = new Set(['object', 'group']);

/**
 * The separator's own alias table — the subset of {@link NAV_ITEM_ALIASES} whose
 * TARGET the separator branch actually declares.
 *
 * A separator is a divider: `type`, an optional `id`, an optional `order`, and
 * nothing else. Every other entry in the shared table would name a key this
 * branch rejects, so it is demoted to {@link SEPARATOR_NAV_ITEM_GUIDANCE}.
 */
const SEPARATOR_NAV_ITEM_ALIASES: Readonly<Record<string, string>> = {
  name: 'id',
  sort: 'order',
  sortorder: 'order',
  position: 'order',
};

/**
 * What a separator answers for the base nav keys it does NOT declare.
 *
 * One sentence, filed under each key an author is likely to reach for, because
 * they all have the same answer: a divider carries no label, no icon, no badge
 * and no gate — those belong on the items it separates, and a *titled* section
 * is a `group`, not a separator. Filed as `guidance` rather than as aliases
 * because there is no key here to rename onto (finding 7 is exactly the mistake
 * of answering with one).
 */
const SEPARATOR_NAV_ITEM_GUIDANCE: Readonly<Record<string, string>> = Object.fromEntries(
  ['label', 'title', 'icon', 'badge', 'badgeVariant', 'visible', 'requiredPermissions', 'requiresObject', 'requiresService']
    .map((key) => [
      key,
      `\`${key}\` is not a separator key — a separator is a divider and declares only `
      + '`id` and `order`. Put labels, icons, badges and visibility gating on the items it '
      + "separates, or use `{ type: 'group', label: '…' }` for a titled section.",
    ]),
);

/**
 * Authoring-surface options for one nav-item variant.
 *
 * Each variant gets its own table so the "did you mean" pool is that variant's
 * real key set — suggesting `dashboardName` on a `url` item would be noise, not
 * help. Before #5593 the pool was a hand-transcribed
 * `[...BASE_NAV_ITEM_KEYS, ...NAV_VARIANT_KEYS[variant]]`; `strictObject` reads
 * it from the branch's `.shape` instead, so the two copies became one and the
 * nine tables joined the shape-backed half of the alias-integrity gate — which
 * is where the "alias target must be a key this shape accepts" claim finally
 * reaches the family that historically broke it (#5555).
 *
 * ⚠️ The PROSE targets below survive that stronger judgement deliberately, and
 * `alias-integrity.test.ts`'s `PROSE_ALIAS_TARGETS` allowlist matches these
 * strings EXACTLY. They are not key names and must not become key names: the
 * key an author wrote is spelled correctly, it is the `type` that is wrong, so
 * answering with a bare key name would be ledger finding 7 (a rename onto a key
 * this variant also rejects).
 */
const navItemSurface = (variant: NavItemVariant): StrictObjectOptions => ({
  surface: `this \`${variant}\` navigation item`,
  aliases: {
    // ⚠️ `separator` is the ONE branch that spreads nothing — it declares
    // `type`/`id`/`order` and no more — so the shared table's targets (`label`,
    // `visible`, `requiredPermissions`, `badgeVariant`, `requiresObject`) are
    // keys IT REJECTS. Answering `title` with *"did you mean `label`?"* there
    // was ledger finding 7, live on `main`: the author fixes the spelling as
    // instructed and is rejected a second time, with no suggestion left. It
    // survived #5483's guard because the hand-transcribed key list handed every
    // variant `[...BASE_NAV_ITEM_KEYS, ...]`, base keys included, so the
    // transcription said `label` was known here and the guard believed it —
    // the exact array-vs-shape drift #5593 exists to abolish, found by the
    // migration itself. The nine base-only spellings become a PRESCRIPTION
    // below instead of a rename.
    ...(variant === 'separator' ? SEPARATOR_NAV_ITEM_ALIASES : NAV_ITEM_ALIASES),
    // Cross-variant payloads: naming the right key on the wrong `type` is
    // the commonest nav mistake, so point at the type that owns it.
    ...(variant !== 'object' ? { objectname: 'type: \'object\' (with objectName)' } : {}),
    ...(variant !== 'page' ? { pagename: 'type: \'page\' (with pageName)' } : {}),
    ...(variant !== 'url' ? { url: 'type: \'url\' (with url)' } : {}),
    ...(variant !== 'dashboard' ? { dashboardname: 'type: \'dashboard\' (with dashboardName)' } : {}),
    ...(variant !== 'report' ? { reportname: 'type: \'report\' (with reportName)' } : {}),
    ...(variant !== 'component' ? { componentref: 'type: \'component\' (with componentRef)' } : {}),
    // `expanded` is a cross-variant key too — it just looks shared because
    // "start expanded" is a sidebar-wide idea. It exists on `group` alone, so
    // only `group` may answer with the bare key name (#5555).
    ...(variant !== 'group' ? NAV_EXPANDED_ALIASES_ELSEWHERE : NAV_EXPANDED_ALIASES_ON_GROUP),
  },
  // The recursive `children` key, which lives on the UNION member rather than on
  // the branch — see {@link NAV_VARIANTS_ACCEPTING_CHILDREN}. Naming it keeps a
  // near-miss resolvable on the surface that really accepts it.
  ...(NAV_VARIANTS_ACCEPTING_CHILDREN.has(variant) ? { extraKeys: ['children'] } : {}),
  // Filed only where it can FIRE. `children` is legal on the `object` and
  // `group` members, so the prescription is written for the other seven; #5483's
  // guard had to exempt the two by name (`VARIANT_LEGAL_GUIDANCE`) because a
  // transcription cannot tell a legal variant from a dead entry. The shape can,
  // so the exemption is deleted and the table is simply correct per variant
  // (#5593) — the same demotion-instead-of-tolerance move #5555 made one field
  // over. The separator's own prescriptions ride alongside it.
  guidance: {
    ...(NAV_VARIANTS_ACCEPTING_CHILDREN.has(variant)
      ? {}
      : {
          children:
            '`children` is only meaningful on a `group` item (or an `object` item nesting its ' +
            'views). Nest entries under `{ type: \'group\', children: [...] }`.',
        }),
    ...(variant === 'separator' ? SEPARATOR_NAV_ITEM_GUIDANCE : {}),
  },
  history:
    'Until #4001 these were dropped silently — the entry still parsed, so a mis-spelled ' +
    'config shipped as a nav item that quietly ignored it (a stripped `visible` renders ' +
    'an entry that should have been gated).',
});

/**
 * Shared shape of every navigation item — spread into the nine branches below.
 *
 * ## ⛔ Deliberately still `.strip()` — #4001 批 19 measured it and left it alone
 *
 * This is `ui/app.zod.ts`'s last open site, and it is NOT unfinished work.
 * The ledger held it as `verify` on the assumption that the branches
 * `.extend()` this base, which would make closing it inherit down into all
 * nine (finding 16 — the trap that turned `view`'s Studio round-trip overlay
 * into a 422). They do not: they spread `...BaseNavItemSchema.shape`, and a
 * spread copies the per-key schemas into a FRESH `z.object` whose posture is
 * its own. Nothing inherits from here, in either direction.
 *
 * And every branch already applies its own `strictObject` with the curated
 * per-variant table ({@link navItemSurface}; `navItemUnknownKeyError` until
 * #5593), so every key this base contributes is ALREADY gated at all nine
 * doors — and, since #5593, the "did you mean" pool each door offers is read
 * from that branch's own shape rather than from a transcription that included
 * these keys whether the branch spread them or not. This schema is module-private and is never parsed —
 * `.strict()` is a property of a PARSE, so closing it would enforce exactly
 * nothing while making a shape fragment look load-bearing (#4583: *"a
 * precisely-validated dead slot is the more convincing lie"*).
 *
 * The `Class` cell it should carry was an open question (#5249), because the
 * ledger's enumerated vocabulary had no word for a shape that is neither a door
 * nor dead. **Ruled 2026-08-06: the vocabulary grew one — `covered`** (carrier
 * absent, parse absent, vocabulary fully gated at every consumer; follow-up:
 * none), and this schema is its only instance in the five triaged directories —
 * a spread is what makes the base inert, and it is the only strip site in all
 * 197 that is spread rather than `.extend()`ed or carried under a key.
 *
 * Pinned in `app-strictness-batch19.test.ts`, including the mechanism itself
 * (`.extend()` inherits posture, `...shape` does not) and a guard that fails if
 * any branch ever stops rejecting unknown keys — which is the one change that
 * would make this verdict need re-taking.
 */
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
export const ObjectNavItemSchema = lazySchema(() => strictObject(navItemSurface('object'), {
  ...BaseNavItemSchema.shape,
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
export const DashboardNavItemSchema = lazySchema(() => strictObject(navItemSurface('dashboard'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('dashboard'),
  dashboardName: z.string().describe('Target dashboard name'),
}));

/**
 * 3. Page Navigation Item
 * Navigates to a custom UI page/component.
 */
export const PageNavItemSchema = lazySchema(() => strictObject(navItemSurface('page'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('page'),
  pageName: z.string().describe('Target custom page component name'),
  // OPEN by design: the page owns its own param contract.
  params: z.record(z.string(), z.unknown()).optional().describe('Parameters passed to the page context'),
}));

/**
 * 4. URL Navigation Item
 * Navigates to an external or absolute URL.
 */
export const UrlNavItemSchema = lazySchema(() => strictObject(navItemSurface('url'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('url'),
  url: z.string().describe('Target external URL'),
  target: z.enum(['_self', '_blank']).default('_self').describe('Link target window'),
}));

/**
 * 5. Report Navigation Item
 * Navigates to a specific report.
 */
export const ReportNavItemSchema = lazySchema(() => strictObject(navItemSurface('report'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('report'),
  reportName: z.string().describe('Target report name'),
}));

/**
 * 6. Action Navigation Item
 * Triggers an action (e.g. opening a flow, running a script, or launching a screen action).
 */
export const ActionNavItemSchema = lazySchema(() => strictObject(navItemSurface('action'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('action'),
  actionDef: strictObject(
    {
      surface: "this nav item's action definition",
      aliases: { action: 'actionName', name: 'actionName', args: 'params', input: 'params' },
      history:
        'Until #4001 these were dropped silently — the definition still parsed, so clicking ' +
        'the entry dispatched a different action than the author declared.',
    },
    {
    actionName: z.string().describe('Action machine name to execute'),
    // OPEN by design: the action owns its own param contract.
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
export const ComponentNavItemSchema = lazySchema(() => strictObject(navItemSurface('component'), {
  ...BaseNavItemSchema.shape,
  type: z.literal('component'),
  componentRef: z.string().describe('Component registry key (e.g. "metadata:directory")'),
  // OPEN by design: props are the component's own contract.
  params: z.record(z.string(), z.unknown()).optional().describe('Props passed to the component'),
}));

/**
 * 8. Group Navigation Item
 * A container for child navigation items (Sub-menu).
 * Does not perform navigation itself.
 */
export const GroupNavItemSchema = lazySchema(() => strictObject(navItemSurface('group'), {
  ...BaseNavItemSchema.shape,
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
const SeparatorNavItemSchema = lazySchema(() => strictObject(navItemSurface('separator'), {
  type: z.literal('separator'),
  id: SnakeCaseIdentifierSchema.optional().describe('Optional id for the separator'),
  order: z.number().optional().describe('Sort order within the same level (lower = first)'),
}));

/** Separator branch — internal, mirrors {@link SeparatorNavItemSchema}. */
type SeparatorNavItem = z.infer<typeof SeparatorNavItemSchema>;

/**
 * Recursive union of every navigation item type — the TYPE half of
 * {@link NavigationItemSchema}, and the annotation that breaks its circular
 * inference.
 *
 * Spelled out here rather than derived with `z.infer<typeof NavigationItemSchema>`
 * because that inference is exactly what the recursion cannot compute: the
 * schema needs an annotation, and the `z.ZodType<any>` this used to carry made
 * `NavigationItem` resolve to `any` for every consumer (#4171). `any` is
 * mutually assignable with everything, so a consumer deleting its own
 * `NavigationItem` in favour of this import — what #4115 asks for — silently
 * traded a precise type for one that constrains nothing.
 *
 * Only the recursive `children` knot is tied by hand; each branch still derives
 * from its own schema, so a key added to `ObjectNavItemSchema` lands here too.
 */
export type NavigationItem =
  | (ObjectNavItem & { children?: NavigationItem[] })
  | DashboardNavItem
  | PageNavItem
  | UrlNavItem
  | ReportNavItem
  | ActionNavItem
  | ComponentNavItem
  | SeparatorNavItem
  | GroupNavItem;

/**
 * The INPUT half of {@link NavigationItemSchema} — what an author writes, as
 * opposed to what a parse returns.
 *
 * `z.ZodType` takes TWO type parameters, `<Output, Input>`, and **`Input`
 * defaults to `unknown`**. #4171 fixed the annotation's Output half (it used to
 * be `z.ZodType<any>`, which made the exported `NavigationItem` `any` for every
 * consumer) but left `Input` at that default — so `z.input<typeof AppSchema>`
 * resolved `navigation` to `unknown`, and `unknown` accepts everything. The
 * documented authoring entry point, `defineApp(config: z.input<typeof AppSchema>)`,
 * therefore took `navigation: [{ totally: 'made up' }, 42, 'nonsense']` with a
 * clean compile. That is the same "a type that constrains nothing" failure
 * #4171 describes, surviving on the half nobody re-measured: the fix was
 * verified through `z.infer` and `z.input` was never checked.
 *
 * The two halves genuinely differ, which is why one union cannot serve both:
 * `GroupNavItemSchema.expanded` and `UrlNavItemSchema.target` carry
 * `.default()`, so they are REQUIRED in the output and OPTIONAL here. Reusing
 * {@link NavigationItem} as the input type would demand authors write values
 * the schema exists to supply.
 *
 * Both recursive branches tie their `children` knot inline. The output union
 * ties `object` inline but inherits `group`'s knot from the {@link GroupNavItem}
 * alias — an asymmetry kept only because that alias is public API.
 * `app.nav-type-assertions.ts` pins both unions at compile level.
 */
export type NavigationItemInput =
  | (z.input<typeof ObjectNavItemSchema> & { children?: NavigationItemInput[] })
  | z.input<typeof DashboardNavItemSchema>
  | z.input<typeof PageNavItemSchema>
  | z.input<typeof UrlNavItemSchema>
  | z.input<typeof ReportNavItemSchema>
  | z.input<typeof ActionNavItemSchema>
  | z.input<typeof ComponentNavItemSchema>
  | z.input<typeof SeparatorNavItemSchema>
  | (z.input<typeof GroupNavItemSchema> & { children: NavigationItemInput[] });

/**
 * Recursive Union of all navigation item types.
 * Allows constructing an unlimited-depth navigation tree.
 *
 * The trailing cast to `z.ZodType<NavigationItem, NavigationItemInput>` is forced
 * by the member-array widening below: `discriminatedUnion` reports the output of a
 * `ZodObject<ZodRawShape>` member as `Record<string, unknown>`, so the union's
 * inferred output carries no branch shapes at all. That fits the `z.ZodType<any>`
 * this used to be annotated with — and nothing sharper, which is how the exported
 * `NavigationItem` came to be `any` for every consumer (#4171).
 *
 * BOTH type parameters are spelled out. Naming only the first leaves `Input` at
 * its `unknown` default, which silently un-checks every authoring path through
 * this schema — see {@link NavigationItemInput}.
 *
 * What the cast does NOT weaken: every branch of {@link NavigationItem} is
 * `z.infer<typeof XNavItemSchema>`, so a key added to any variant's schema still
 * flows into the exported type with no edit here. What it leaves unchecked is
 * only the MEMBERSHIP of the list — a branch added to the schema and not to the
 * type, or the reverse — which app.test.ts covers at runtime by parsing all nine
 * ("accepts every variant with its full declared payload").
 */
export const NavigationItemSchema: z.ZodType<NavigationItem, NavigationItemInput> = z.lazy(() =>
  // DISCRIMINATED on `type` (#4001 PR B). With `.strict()` members a plain
  // union would answer one unknown key with an `invalid_union` aggregate
  // listing all nine branches' failures; discriminating on `type` first means
  // the author gets a single `unrecognized_keys` issue against the branch they
  // actually wrote, at an exact path (`navigation.0.children.2`), and a
  // mistyped `type` gets "Invalid discriminator value" instead of that wall.
  z.discriminatedUnion('type', [
    ObjectNavItemSchema.extend({
      children: z.array(NavigationItemSchema).optional().describe('Child navigation items (e.g. specific views)'),
    }).strict().superRefine(objectNavTargetExclusivity),
    DashboardNavItemSchema,
    PageNavItemSchema,
    UrlNavItemSchema,
    ReportNavItemSchema,
    ActionNavItemSchema,
    ComponentNavItemSchema,
    SeparatorNavItemSchema,
    GroupNavItemSchema.extend({
      children: z.array(NavigationItemSchema).describe('Child navigation items'),
    }).strict(),
    // The members are lazySchema Proxies and a superRefine-wrapped variant, so
    // the array is widened for the discriminator-typed overload; runtime
    // discrimination works on all of them (asserted in app.test.ts).
  ] as unknown as readonly [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]]) as unknown as z.ZodType<NavigationItem, NavigationItemInput>
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
export const NavigationContributionSchema = lazySchema(() => strictObject(
  {
    surface: 'this navigation contribution',
    aliases: { targetapp: 'app', appname: 'app', targetgroup: 'group', groupid: 'group', order: 'priority', navigation: 'items' },
    history:
      'Until #4001 these were dropped silently — the contribution still parsed, so a ' +
      'package injected its menu into the wrong place, or nowhere.',
  },
  {
  app: SnakeCaseIdentifierSchema.describe('Target app name to contribute navigation into (e.g. "setup")'),
  group: SnakeCaseIdentifierSchema.optional().describe('Target group nav-item id to append into (e.g. "group_integrations"); omit to append at the app top level'),
  priority: z.number().int().min(0).default(200).describe('Merge priority within the target group — lower applied first (matches object extender priority)'),
  items: z.array(NavigationItemSchema).describe('Navigation items contributed into the target app/group'),
}).describe('A navigation contribution: a package injecting nav items into an app it does not own (ADR-0029 D7)'));
/**
 * The authoring shape of a contribution (#4195) — `priority` is `.default(200)`
 * and each item is a {@link NavigationItemInput}, so this is what a package
 * declaring its menu entries actually writes. Spelled
 * `NavigationContributionInput` until ADR-0122 phase 2 retired that synonym.
 */
export type NavigationContribution = z.input<typeof NavigationContributionSchema>;
/** Post-parse shape of {@link NavigationContribution} — defaults applied, transforms run (ADR-0122). */
export type NavigationContributionParsed = z.infer<typeof NavigationContributionSchema>;

/**
 * App Branding Configuration
 * Allows configuring the look and feel of the specific app.
 */
export const AppBrandingSchema = lazySchema(() => strictObject(
  {
    surface: "this app's branding block",
    aliases: { primary: 'primaryColor', accent: 'accentColor', color: 'primaryColor', logourl: 'logo', icon: 'favicon', theme: 'primaryColor' },
    history:
      'Until #4001 these were dropped silently — branding still parsed, so a theme the ' +
      'author set never reached the shell.',
  },
  {
  primaryColor: z.string().optional().describe('Primary theme color hex code'),
  accentColor: z.string().optional().describe('Accent color hex code (highlights, active states). Declared to match the objectui ConsoleLayout read of branding.accentColor (inverse-drift fix, liveness audit #1878/#1891/#1894).'),
  logo: z.string().optional().describe('Custom logo URL for this app'),
  favicon: z.string().optional().describe('Custom favicon URL for this app'),
}));

/**
 * `app.areas[].order`, retired in 17.0.0 (#4667, ADR-0049).
 *
 * The sibling that works is what made this one read alive: nav-item `order` IS
 * sorted (`NavigationRenderer.tsx:1154`). Area-level order is not — `AppSidebar`
 * and `AppSchemaRenderer` both iterate the `areas` array as authored — so
 * declaration order has always been display order, and an author who set
 * `order` to rearrange areas saw nothing move.
 */
const AREA_ORDER_RETIRED =
  '`areas[].order` was removed in @objectstack/spec 17.0.0 (#4667, ADR-0049) — no renderer '
  + 'ever sorted areas; both the sidebar and the schema renderer iterate the array as '
  + 'authored, so declaration order already IS display order. Delete the key and reorder the '
  + '`areas` array itself. NOTE the neighbour that behaves differently: a navigation ITEM\'s '
  + '`order` is genuinely sorted — this removal does not touch it. Run '
  + '`os migrate meta --from 16` to rewrite existing sources automatically.';

/**
 * `app.areas[].visible` and `app.areas[].requiredPermissions`, retired in
 * 17.0.0 (#4651, ADR-0049).
 *
 * These were not ordinary dead keys. They were **fail-open capability gates**:
 * at the time of the retirement the authoritative server-side filter
 * (`filterAppForUser`, `packages/rest/src/rest-server.ts`) read the app's
 * `requiredPermissions` and then walked ONLY `item.navigation` — it returned
 * early when that tree was absent and never touched `item.areas` at all — while
 * the client rendered every area in the switcher. So an author who wrote
 * `requiredPermissions: ['sales.admin']` on an area got a clean parse, a stored
 * value, and an area visible to everyone.
 *
 * What made them read alive is that the SAME key names are genuinely enforced
 * one level up and one level down: app-level `requiredPermissions` drops the
 * whole app server-side, and a navigation ITEM's `requiredPermissions` /
 * `requiresService` are stripped server-side and re-checked in the shell, whose
 * item-level `visible` is a real CEL gate. Three layers, of which the middle one
 * was theatre — ADR-0078 false compliance, the `capabilities.readOnly` shape
 * (#4583).
 *
 * Enforcing them instead (route A) was considered and deliberately not taken in
 * the 17.0.0 window: it needs semantics decided first (does filtering an area
 * remove its items everywhere? does the server bind `user` for area CEL?), and
 * a retirement PR must not invent an authorization mechanism. Removing a gate
 * that never gated is strictly safer than shipping a major with it in place.
 *
 * SINCE #4722 the paragraph above is history on one point, and the prescription
 * below states the current fact: `filterAppForUser` now runs the same
 * `filterNav` over every `areas[].navigation`, so an ITEM's
 * `requiredPermissions` / `requiresService` is enforced server-side in both
 * trees and a gated entry never ships in the `/meta` body. That closed the
 * shell-only boundary these prescriptions used to warn about; it did NOT revive
 * the area-LEVEL keys, which stay retired. `visible` (CEL) and `requiresObject`
 * remain client-side only at every level — server-side CEL needs a bound `user`
 * context the read layer does not have. Mirrored in `liveness/app.json`
 * (`areas.navigation`) and pinned in `packages/rest/src/rest.test.ts`.
 */
const AREA_VISIBLE_RETIRED =
  '`areas[].visible` was removed in @objectstack/spec 17.0.0 (#4651, ADR-0049) — nothing ever '
  + 'evaluated an area-level predicate, so an area "hidden" by one rendered for EVERYONE: a '
  + 'gate that fails open, which is worse than no gate at all. Delete the key and gate the '
  + 'items INSIDE the area — a navigation ITEM\'s `visible` takes the same CEL expression and '
  + 'IS evaluated per item by the shell. For a gate the SERVER enforces, use '
  + '`requiredPermissions` instead: on the app itself, or on the ITEMS of either navigation '
  + 'tree — the app\'s top-level `navigation` AND every `areas[].navigation`, both stripped '
  + 'server-side since #4722. The distinction survives at every level: `visible` is CEL '
  + 'evaluated in the browser, so it hides an entry that has already been sent, while '
  + '`requiredPermissions` stops that entry from being served at all. Run '
  + '`os migrate meta --from 16` to rewrite existing sources automatically.';

const AREA_REQUIRED_PERMISSIONS_RETIRED =
  '`areas[].requiredPermissions` was removed in @objectstack/spec 17.0.0 (#4651, ADR-0049) — '
  + 'no layer ever checked it, so a "permission-gated" area was served to, and rendered for, '
  + 'every user: a fail-open access gate, not merely an unread key. Delete it and move the '
  + 'gate to a layer that is actually enforced. `requiredPermissions` on the APP is checked '
  + 'server-side (the app is dropped from /meta entirely for a caller who lacks them), and '
  + '`requiredPermissions` / `requiresService` on a navigation ITEM are stripped server-side '
  + 'in BOTH trees — the app\'s top-level `navigation` AND every `areas[].navigation`, through '
  + 'the same filter since #4722 — then re-checked in the shell, so an item gated inside an '
  + 'area never reaches the browser either. That enforces the items INSIDE an area; the '
  + 'area-level key is not revived. Still evaluated client-side ONLY, at every level: '
  + '`visible` (CEL) and `requiresObject` — so anything that must never reach the browser '
  + 'goes in `requiredPermissions`, never in `visible`. Run `os migrate meta --from 16` to '
  + 'rewrite existing sources automatically.';

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
 * An area is a LAYOUT grouping, not an access boundary: it carries no gate of
 * its own. Gate the items inside it (`visible` / `requiredPermissions` on a
 * navigation item) or gate the app (`requiredPermissions` on the AppSchema) —
 * see AREA_VISIBLE_RETIRED / AREA_REQUIRED_PERMISSIONS_RETIRED above for why
 * the area-level keys were removed in 17.0.0.
 *
 * @example
 * ```ts
 * const salesArea: NavigationArea = {
 *   id: 'area_sales',
 *   label: 'Sales',
 *   icon: 'briefcase',
 *   navigation: [
 *     { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
 *     // gate per ITEM — the layer that is actually enforced
 *     { id: 'nav_forecast', type: 'object', label: 'Forecast', objectName: 'forecast',
 *       requiredPermissions: ['sales.admin'] },
 *   ],
 * };
 * ```
 */
export const NavigationAreaSchema = lazySchema(() => strictObject(
  {
    surface: 'this navigation area',
    // `sort: 'order'` retired with the key it pointed at (#4667); the three
    // gating aliases (`visibleWhen`/`visibleOn`/`permissions`) retired with
    // theirs (#4651). An alias must never rename onto a key that is itself
    // gone — it would answer "unknown key" with a second unknown key — so each
    // moves to `guidance` and carries the prescription instead.
    aliases: { title: 'label', name: 'id', items: 'navigation', children: 'navigation' },
    guidance: {
      order: AREA_ORDER_RETIRED,
      sort: AREA_ORDER_RETIRED,
      visible: AREA_VISIBLE_RETIRED,
      visibleWhen: AREA_VISIBLE_RETIRED,
      visibleOn: AREA_VISIBLE_RETIRED,
      requiredPermissions: AREA_REQUIRED_PERMISSIONS_RETIRED,
      permissions: AREA_REQUIRED_PERMISSIONS_RETIRED,
    },
    history:
      'Until #4001 these were dropped silently — the area still parsed, so its gating or ' +
      'ordering was quietly ignored.',
  },
  {
  /** Unique area identifier */
  id: SnakeCaseIdentifierSchema.describe('Unique area identifier (lowercase snake_case)'),

  /** Display label */
  label: I18nLabelSchema.describe('Area display label'),

  /** Icon name (Lucide) */
  icon: z.string().optional().describe('Area icon name'),

  // `order` removed in 17.0.0 (#4667) — see AREA_ORDER_RETIRED. Reorder the
  // `areas` array instead; declaration order is display order.

  /** Area description */
  description: I18nLabelSchema.optional().describe('Area description'),

  // `visible` and `requiredPermissions` removed in 17.0.0 (#4651) — see
  // AREA_VISIBLE_RETIRED / AREA_REQUIRED_PERMISSIONS_RETIRED. Both were
  // FAIL-OPEN gates: no layer read them, while the identically named keys on a
  // navigation ITEM and on the APP are enforced. Gate the items inside the area
  // (or the app) instead.

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
/**
 * Keys retired from {@link AppContextSelectorSchema} in 17.0.0 (#4509, ADR-0049).
 *
 * Both carried schema defaults, so the liveness advisory lint could never warn
 * on them — a default materialises at parse time, making an authored value
 * indistinguishable from one the schema supplied (`_authorWarnSkipped` in
 * `liveness/app.json`). Removal was the only channel that could reach an
 * author, which is why they went out inside the 17.0.0 window.
 *
 * `includeAll` is the more important of the two: it was not merely unread, it
 * was deliberately DISOBEYED, and for a security reason.
 */
const CONTEXT_SELECTOR_RETIRED_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  includeAll:
    '`contextSelectors[].includeAll` was removed in @objectstack/spec 17.0.0 (#4509, '
    + 'ADR-0049) — the shell deliberately ignored it. A context selector is a MANDATORY '
    + 'scope: an "All" row would clear the scope on a surface that exists to be scoped, and '
    + "on Studio's package selector that means listing the platform's own system/cloud "
    + 'kernel metadata to a developer who scoped to their own package. The renderer never '
    + 'offered an All row regardless of this flag, so `includeAll: false` hardened nothing '
    + 'and `includeAll: true` unlocked nothing. Delete the key. To widen what a selector '
    + 'offers, widen `optionsSource.filter` instead. Run `os migrate meta --from 16` to '
    + 'rewrite existing sources automatically.',
  showall:
    '`contextSelectors[].includeAll` (which `showall` aliased) was removed in '
    + '@objectstack/spec 17.0.0 (#4509) — selectors are mandatory-scope and never render an '
    + '"All" row. Delete the key; widen `optionsSource.filter` to widen the choices.',
  placement:
    '`contextSelectors[].placement` was removed in @objectstack/spec 17.0.0 (#4509, '
    + 'ADR-0049) — no renderer ever read it. Selectors always render in the sidebar header '
    + "block, and `'topbar'` placed nothing in the topbar. Delete the key. Run "
    + '`os migrate meta --from 16` to rewrite existing sources automatically.',
  location:
    '`contextSelectors[].placement` (which `location` aliased) was removed in '
    + '@objectstack/spec 17.0.0 (#4509) — selectors always render in the sidebar header. '
    + 'Delete the key.',
};

export const AppContextSelectorSchema = lazySchema(() => strictObject(
  {
    surface: 'this app context selector',
    aliases: { name: 'id', title: 'label', source: 'optionsSource', options: 'optionsSource' },
    guidance: CONTEXT_SELECTOR_RETIRED_KEY_GUIDANCE,
    history:
      'Until #4001 these were dropped silently — the selector still parsed, so its scope ' +
      'variable behaved differently than declared.',
  },
  {
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
  optionsSource: strictObject(
    {
      surface: "this context selector's options source",
      aliases: { url: 'endpoint', path: 'endpoint', value: 'valueKey', label: 'labelKey', filters: 'filter', where: 'filter' },
      history:
        'Until #4001 these were dropped silently — the source still parsed, so the ' +
        'dropdown resolved its options from a different shape than declared.',
    },
    {
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
    filter: z.array(strictObject(
      {
        surface: 'this context-selector option filter',
        aliases: { field: 'key', path: 'key', operator: 'op', values: 'value' },
        history:
          'Until #4001 these were dropped silently — the predicate still parsed, so the ' +
          'option list was not narrowed the way the author declared.',
      },
      {
      key: z.string().describe('Dotted path on each row to compare (e.g. "manifest.scope")'),
      op: z.enum(['eq', 'ne', 'in', 'nin']).default('eq')
        .describe('Comparison operator: eq | ne | in | nin'),
      value: z.union([z.string(), z.array(z.string())])
        .describe('Comparison value (string for eq/ne, string[] for in/nin)'),
    })).optional().describe('Predicates (AND) each option row must satisfy'),
  }).describe('Option data source'),

  // `includeAll` and `placement` were removed in 17.0.0 (#4509) — see
  // CONTEXT_SELECTOR_RETIRED_KEY_GUIDANCE above.

  /**
   * The "nothing concrete is selected" sentinel.
   *
   * NOT an "All option" value — there is no All option (see the `includeAll`
   * prescription above). This is the value the scope variable holds before the
   * user picks a row: the shell auto-selects the first option when this is the
   * current value, and omits the query parameter while the selection equals it.
   * Empty string is almost always right; set it only if a real option value
   * would collide with `''`.
   */
  allValue: z.string().default('')
    .describe('Sentinel value meaning "no concrete selection yet" (empty string is almost always right)'),

  /** How the selection is persisted across navigation. */
  persist: z.enum(['query', 'session', 'none']).default('query')
    .describe('Persist selection via URL query, sessionStorage, or not at all'),
}));

export type AppContextSelector = z.input<typeof AppContextSelectorSchema>;
/** Post-parse shape of {@link AppContextSelector} — defaults applied, transforms run (ADR-0122). */
export type AppContextSelectorParsed = z.infer<typeof AppContextSelectorSchema>;

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
/**
 * `app.homePageId`, retired in 17.0.0 (#4667, ADR-0049) — **premise corrected in
 * #4709**, retirement itself upheld.
 *
 * #4667 retired the key saying "no shell ever read it". That was FALSE, and this
 * repo's own record already said so: the 2026-06 AppSchema liveness audit
 * (`docs/audits/2026-06-appschema-property-liveness.md`) listed `homePageId` on
 * the LIVE side, because objectui's console read it —
 * `resolveLandingRoute()`, `packages/app-shell/src/console/AppContent.tsx`
 * (objectui @785b8a5d) — and it was the only thing deciding where an app opened.
 * A tombstone is what the next reader reasons from, so a false reason in one is
 * not cosmetic: #4709 was opened by someone who believed this sentence and only
 * then checked the renderer.
 *
 * What actually condemns the key is its SHAPE, not disuse. It encoded the
 * landing page as an ID cross-reference into `navigation` with no referential
 * integrity — a dangling id fell back to the first item *silently* (that is
 * literally what `resolveLandingRoute` did) — so one fact had two sources and
 * the wrong one failed quietly. If "land somewhere other than first" is ever
 * wanted again, it belongs on the navigation item itself (a
 * `navigation[].landing`-shaped marker: single source, cannot dangle), designed
 * enforce-first — renderer and tests before schema. Until then an app's landing
 * page IS its first navigation item in `order`, and the ROOT landing follows
 * `isDefault` routing (objectui's `RootLandingRedirect`, which was always
 * correct here). Retiring the key left a dead `if (homePageId)` branch in
 * objectui, tracked for removal in objectstack-ai/objectui#3264.
 */
const HOME_PAGE_ID_RETIRED =
  '`app.homePageId` was removed in @objectstack/spec 17.0.0 (#4667, #4709, ADR-0049). '
  + 'objectui\'s console did read it before v17 (`resolveLandingRoute`), so this key had a '
  + 'consumer — it was retired because the capability is better expressed on the navigation '
  + 'item itself than as an ID cross-reference that silently falls back when it dangles. An '
  + 'app\'s landing page IS its first navigation item (by `order`), and the root landing '
  + 'follows `isDefault` routing. Delete the key; to change where an app opens, '
  + 'reorder `navigation` so the intended entry is first, and set `isDefault` on the app that '
  + 'should own the root landing. Run `os migrate meta --from 16` to rewrite existing sources '
  + 'automatically.';

/**
 * The prescription for every author-shaped spelling of the ADR-0045 publish
 * gate (#4829).
 *
 * The gate's key is `_unpublished`, and the `_` prefix is load-bearing: it
 * marks the channel tooling stamps onto artifacts (ADR-0010's `_lock` /
 * `_provenance` envelope, and the prefix `lintAuthoredRecordKeys` skips), so
 * "the machine writes this" is legible from the key alone. That property is
 * only worth having if the near-miss spellings do not route an author onto it,
 * which is why this text tells them to stop rather than to rename.
 *
 * `published` and `draft` are here for the same reason as `unpublished`: an
 * author reaching for publish state on an app reaches for one of the three, and
 * the honest answer to all three is that publish state is not authored — it is
 * the outcome of `POST /packages/:id/publish-drafts`.
 */
const UNPUBLISHED_IS_MACHINE_MANAGED =
  'Publish state is not authorable on an app. The ADR-0045 publish gate is the machine-managed '
  + '`_unpublished` key: the AI materialization path sets it, and `POST /packages/:id/publish-drafts` '
  + '(the "Publish" button) clears it. Delete this key. If you wanted to keep the app out of the App '
  + 'Switcher — the personal-settings case, e.g. Account — that is `hidden: true`, which is navigation '
  + 'presentation ONLY and never affects access (#4829).';

export const AppSchema = lazySchema(() => strictObject(
  {
    surface: 'this app',
    aliases: {
      title: 'label',
      nav: 'navigation',
      menu: 'navigation',
      menus: 'navigation',
      items: 'navigation',
      sidebar: 'navigation',
      tabs: 'navigation',
      sections: 'areas',
      groups: 'areas',
      permissions: 'requiredPermissions',
      // `home` / `homepage` / `landingpage` aliased `homePageId`, retired in
      // 17.0.0 (#4667). They fall through to the tombstone's own prescription
      // rather than renaming onto a key that no longer exists.
      agent: 'defaultAgent',
      logo: 'branding',
      theme: 'branding',
      enabled: 'active',
      default: 'isDefault',
      selectors: 'contextSelectors',
    },
    guidance: {
      pages:
        '`pages` is not an App field — a page is its own metadata record; reference it from ' +
        "navigation with `{ type: 'page', pageName: '<name>' }`.",
      views:
        '`views` is not an App field — views belong to their object (`listViews`); reference ' +
        "one from navigation with `{ type: 'object', objectName, viewName }`.",
      flows:
        '`flows` is not an App field — flows are top-level stack metadata ' +
        '(`defineStack({ flows })`), not app-scoped.',
      // The three retired `homePageId` aliases. `retiredKey` already answers the
      // canonical spelling; these cover the spellings that used to route to it.
      home: HOME_PAGE_ID_RETIRED,
      homepage: HOME_PAGE_ID_RETIRED,
      landingpage: HOME_PAGE_ID_RETIRED,
      // #4829 — the publish gate is `_unpublished`, and it is MACHINE-managed.
      // An explicit entry rather than the edit-distance suggester, which would
      // answer this spelling with a bare "did you mean `_unpublished`?" and so
      // teach the one thing the key exists to prevent: an author writing it.
      unpublished: UNPUBLISHED_IS_MACHINE_MANAGED,
      published: UNPUBLISHED_IS_MACHINE_MANAGED,
      draft: UNPUBLISHED_IS_MACHINE_MANAGED,
    },
    history:
      'Until #4001 these were dropped silently — the app still parsed, so navigation or ' +
      'gating the author declared never reached the shell.',
  },
  {
  /** Machine name (id) */
  name: SnakeCaseIdentifierSchema.describe('App unique machine name (lowercase snake_case)'),
  
  /** Display label */
  label: I18nLabelSchema.describe('App display label'),

  /**
   * REMOVED — never read by any consumer (2026-06 AppSchema liveness audit).
   * An app's version is its owning package's `manifest.version`; a second
   * per-app number had no reader and could silently disagree with it.
   */
  version: retiredKey(
    '`App.version` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit — ' +
    'no consumer in framework or objectui). An app is versioned by its owning package: ' +
    'use `manifest.version`. Delete the key.',
  ),

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
   *
   * ⛔ **NOT an access gate, and never was one on this surface.** Between
   * ADR-0045 (2026-06-12) and its 2026-08 revision the REST metadata gate
   * (`filterAppForUser`, `packages/rest/src/rest-server.ts`) read THIS key as
   * "unpublished ⇒ externally unobservable", which is a second, contradictory
   * contract on one boolean. The measured cost (#4829): the platform's own
   * `account` app is authored `hidden: true` for exactly the reason this
   * docblock gives, so every user without `studio.access`/`setup.access` had it
   * erased from `GET /meta/app` — password, avatar, sessions and inbox all
   * unreachable, while any admin saw a healthy system. Presentation and
   * lifecycle are orthogonal; the publish gate now rides its own machine-managed
   * key, `_unpublished` (declared directly below). Authoring `hidden: true` affects
   * navigation and nothing else.
   */
  hidden: z.boolean().optional()
    .describe('Hide from the App Switcher; the shell surfaces hidden apps via the avatar menu instead (navigation only — never an access gate)'),

  /**
   * ADR-0045 §3 — the **publish gate**. `true` means the app is *unpublished*:
   * externally unobservable, not merely unlisted. `filterAppForUser` drops it
   * from every metadata response except a builder's (`studio.access` /
   * `setup.access`, for direct-URL preview); ADR-0045's discovery, direct-API
   * and outbound-side-effect gates hang off the same bit.
   *
   * **Machine-managed — do not author it.** It is written by the AI additive
   * materialization path (which lands a real, invisible app) and cleared by
   * `POST /packages/:id/publish-drafts` (the visibility flip that IS "Publish").
   * The `_` prefix is this repo's marker for the channel tooling stamps onto
   * artifacts rather than an author writing it — the same channel as ADR-0010's
   * `_lock` / `_provenance` / `_packageId` envelope, and the prefix
   * `lintAuthoredRecordKeys` already exempts from the unknown-authoring-key
   * report for that reason.
   *
   * Why a dedicated key and not `hidden` (#4829, maintainer ruling 2026-08-04):
   * `hidden: true` is a spelling an author — very often an AI (ADR-0033) —
   * reaches for naturally on a personal-settings app, and under the old regime
   * that spelling silently 404'd the app for every non-builder. Nobody reaches
   * for `_unpublished` by accident, so the failure mode this key can produce is
   * bounded to the machine that owns it.
   *
   * It is declared here (rather than omitted) because the write path validates
   * against this very schema — `saveMetaItem` answers 422 on an off-spec body,
   * and `Registry.validate('app', …)` runs `AppSchema.parse` — so the flip and
   * the ADR-0087 conversion of stored rows both need the key to be legal.
   */
  _unpublished: z.boolean().optional()
    .describe('Machine-managed publish gate (ADR-0045 §3) — true = unpublished, externally unobservable. Written by AI materialization, cleared by publish-drafts. Never authored.'),

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
   * REMOVED in 17.0.0 (#4667) — see {@link HOME_PAGE_ID_RETIRED}. Tombstoned
   * rather than deleted, matching the seven #4142 retirements on this schema:
   * `retiredKey` types it `never`, so an app still authoring it fails to
   * compile as well as to parse.
   */
  homePageId: retiredKey(HOME_PAGE_ID_RETIRED),

  /** 
   * Access Control
   * List of permissions required to access this app.
   * Modern replacement for role/profile based assignment.
   * Example: ["app.access.crm"]
   */
  requiredPermissions: z.array(z.string()).optional().describe('Permissions required to access this app'),
  
  /**
   * REMOVED — the self-described "config file convenience" slots were never
   * read (2026-06 liveness audit): objects register via `defineStack`, and the
   * ambient chatbot derives an app's object list from its NAV ITEMS
   * (`collectNavObjects`), never from `App.objects`.
   */
  objects: retiredKey(
    '`App.objects` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit — ' +
    'never read; the spec itself labelled it "config file convenience"). Objects belong ' +
    'to the stack (`defineStack({ objects })`); an app reaches them through its ' +
    'navigation items. Delete the key.',
  ),
  apis: retiredKey(
    '`App.apis` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit — ' +
    'never read). Delete the key and declare the endpoint one level up, on the STACK: ' +
    '`defineStack({ apis })`. That surface EXECUTES from protocol 17 (#5040). Between ' +
    '#4936 and the executor landing it was refused wholesale — nothing mounted a declared ' +
    'path, so every key including `authRequired` parsed and gated nothing — and that ' +
    'blanket refusal is now narrowed to five per-endpoint publish gates (namespace, ' +
    'supported target, mapping, policy, uniqueness): an endpoint that passes them is ' +
    'mounted and serves traffic as soon as the stack is published. Two things to get ' +
    'right when you move it: the path must sit inside your own carve-out, ' +
    '`/api/v1/apps/<manifest.namespace>/<subpath>` with an explicit `manifest.namespace` ' +
    '(ADR-0121 D1/D2), and `authRequired` defaults to `true` — an explicit `false` is the ' +
    'only thing that opens anonymous access, and ADR-0121 D6 then requires an armed ' +
    '`rateLimit: { enabled: true, windowMs, maxRequests }`. Read the ' +
    '`declarative-apis-endpoints-live` entry of the protocol upgrade guide first; it is a ' +
    'security review, not a rename. A route that genuinely needs handler CODE still ' +
    'belongs in a plugin manifest `contributes.routes` entry.',
  ),

  /**
   * REMOVED — a declared-but-unenforced security surface (ADR-0049 class,
   * 2026-06 liveness audit): the only live sharing/embed path is
   * `FormView.sharing` (public data collection); no public-app or iframe route
   * ever read the app-level blocks, so authoring them created a false
   * security/feature impression.
   */
  sharing: retiredKey(
    '`App.sharing` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit / ' +
    'ADR-0049 enforce-or-remove) — no public-app route ever read it, so it declared ' +
    'sharing that did not exist. Public access is granted per FORM VIEW ' +
    '(`FormView.sharing`, the public-data-collection surface). Delete the key.',
  ),
  embed: retiredKey(
    '`App.embed` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit / ' +
    'ADR-0049) — no iframe route ever read it. Embedding is a per-form-view surface ' +
    '(`FormView.sharing`), not an app-level switch. Delete the key.',
  ),

  /**
   * REMOVED — fully unimplemented (2026-06 liveness audit: even
   * `packages/mobile` ignored it). Re-admit only together with a real mobile
   * navigation implementation, per the ADR-0049 trichotomy — a mode picker
   * that changes nothing is an authoring trap.
   */
  mobileNavigation: retiredKey(
    '`App.mobileNavigation` was removed in @objectstack/spec 17.0.0 (2026-06 liveness ' +
    'audit — fully unimplemented; no renderer, including packages/mobile, ever read ' +
    'it). Delete the key; the block returns if/when a real mobile navigation ships.',
  ),

  /**
   * Default agent for this app's ambient chat surface.
   *
   * When set, the ambient chat endpoint (`POST /api/v1/ai/chat` with
   * `context.appName`) auto-resolves to this agent without the user
   * having to pick from a list.
   *
   * ADR-0063 §1/§2 — this is a SURFACE-BINDING knob, not a custom-agent
   * slot: the resolvable values are the two platform agents (`ask` for a
   * data surface — the default everywhere, so most apps never set this —
   * and `build` for an authoring surface such as Studio). Tenant/app-package
   * custom agents were withdrawn (ADR-0040 §3 reversed); a name that is not
   * a platform agent will not resolve at chat time. To give an app deeper
   * AI capability, author skills — they attach to the platform agents by
   * surface affinity.
   *
   * @example
   * ```ts
   * // An authoring surface pins the build agent; data apps just omit this.
   * defineApp({ name: 'studio', defaultAgent: 'build', ... })
   * ```
   */
  defaultAgent: SnakeCaseIdentifierSchema.optional()
    .describe("Platform agent bound to this app's ambient chat ('ask' is the implicit default; 'build' for authoring surfaces) — ADR-0063 §1"),

  /**
   * REMOVED — never read at the APP level (2026-06 liveness audit). ARIA
   * attributes are live on the page / page-component / list-view surfaces that
   * render DOM. NOT on a dashboard widget: `dashboard.widgets[].aria` was
   * retired in this same 17.0.0 (#5010), so "component/widget" pointed half of
   * its readers at another tombstone (#6756).
   */
  aria: retiredKey(
    '`App.aria` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit — no ' +
    'renderer read app-level ARIA attributes). Declare `aria` on the page component ' +
    'that renders the DOM node instead (`page.components[].aria`; `page.aria` and the ' +
    'list view `aria` are live too). Delete the key.',
  ),

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
export function defineApp(config: z.input<typeof AppSchema>): AppParsed {
  return AppSchema.parse(config);
}

// Main Types
export type App = z.input<typeof AppSchema>;
/** Post-parse shape of {@link App} — defaults applied, transforms run (ADR-0122). */
export type AppParsed = z.infer<typeof AppSchema>;
export type AppBranding = z.input<typeof AppBrandingSchema>;
// `NavigationItem` is declared next to NavigationItemSchema — it IS that
// schema's annotation, so it cannot be inferred back out of it (#4171).
export type NavigationArea = z.input<typeof NavigationAreaSchema>;
/** Post-parse shape of {@link NavigationArea} — defaults applied, transforms run (ADR-0122). */
export type NavigationAreaParsed = z.infer<typeof NavigationAreaSchema>;

// Discriminated Item Types (Helper exports)
export type ObjectNavItem = z.input<typeof ObjectNavItemSchema>;
/** Post-parse shape of {@link ObjectNavItem} — defaults applied, transforms run (ADR-0122). */
export type ObjectNavItemParsed = z.infer<typeof ObjectNavItemSchema>;
export type DashboardNavItem = z.input<typeof DashboardNavItemSchema>;
/** Post-parse shape of {@link DashboardNavItem} — defaults applied, transforms run (ADR-0122). */
export type DashboardNavItemParsed = z.infer<typeof DashboardNavItemSchema>;
export type PageNavItem = z.input<typeof PageNavItemSchema>;
/** Post-parse shape of {@link PageNavItem} — defaults applied, transforms run (ADR-0122). */
export type PageNavItemParsed = z.infer<typeof PageNavItemSchema>;
export type UrlNavItem = z.input<typeof UrlNavItemSchema>;
/** Post-parse shape of {@link UrlNavItem} — defaults applied, transforms run (ADR-0122). */
export type UrlNavItemParsed = z.infer<typeof UrlNavItemSchema>;
export type ReportNavItem = z.input<typeof ReportNavItemSchema>;
/** Post-parse shape of {@link ReportNavItem} — defaults applied, transforms run (ADR-0122). */
export type ReportNavItemParsed = z.infer<typeof ReportNavItemSchema>;
export type ActionNavItem = z.input<typeof ActionNavItemSchema>;
/** Post-parse shape of {@link ActionNavItem} — defaults applied, transforms run (ADR-0122). */
export type ActionNavItemParsed = z.infer<typeof ActionNavItemSchema>;
export type ComponentNavItem = z.input<typeof ComponentNavItemSchema>;
/** Post-parse shape of {@link ComponentNavItem} — defaults applied, transforms run (ADR-0122). */
export type ComponentNavItemParsed = z.infer<typeof ComponentNavItemSchema>;
export type GroupNavItem = z.infer<typeof GroupNavItemSchema> & { children: NavigationItem[] };
