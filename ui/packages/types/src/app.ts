/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Application Schema
 * 
 * Defines the metadata structure for a complete application, including
 * global layout, navigation menus, and routing configuration.
 * 
 * ## Navigation Model
 * 
 * ObjectUI uses a unified `NavigationItem` model aligned with @objectstack/spec.
 * The legacy `AppMenuItem` type is retained for backward compatibility but new
 * configurations should use `NavigationItem` and the `navigation` / `areas` fields.
 */

// Spec 17.0.0-rc.1 gave the spec's own `NavigationItem` a real type — it is no
// longer the `z.ZodType<any>` erasure objectstack#4171 was filed about. That
// removed the ORIGINAL reason this stayed a local interface, but not the
// remaining ones (#3177 triage), and they were never caused by `any`:
//
//   1. Shape. The spec models navigation as a discriminated union of nine
//      `$strict` variants with a `superRefine` exclusivity rule; this is one
//      flat, all-optional shape. Converging is a breaking change for every
//      consumer that reads a target field without narrowing — the verdict
//      already recorded in `__tests__/navigation-spec-parity.test.ts`.
//   2. Three semantics the spec has at NEITHER tier: `visible: boolean` (the
//      spec takes only a CEL string / Expression envelope, yet
//      `menuItemToNavigationItem` below inverts legacy `AppMenuItem.hidden` into
//      a boolean), `pinned` (backs `useNavPins` + `FavoritesProvider`), and the
//      legacy `defaultOpen` spelling. Binding deletes all three from the type
//      while their implementations keep running.
//   3. CLOSED by objectui#10867: a separator carried a `label`, which the spec's
//      separator branch does not declare. `NavigationItem` is now a union whose
//      separator arm ({@link NavigationSeparatorItem}) admits exactly the
//      spec separator's keys — `type`, `id` and `order`.
//
// So the symbol stays local and the KEYS come off the spec one by one — the
// `badgeVariant` precedent (objectstack#4115), widened here to every key with a
// precise spec counterpart. That is the part of the burn-down that is safe
// today: a restated enum or payload shape can drift, and now cannot.
// `spec-derived-unions.test.ts` pins the blockers that remain, each written so
// it fails the day the spec closes it, and asserts the separator agreement in
// place of the blocker it replaced.
import type {
  I18nLabel,
  NavigationArea as SpecNavigationArea,
  NavigationItem as SpecNavigationItem,
  ObjectNavItem as SpecObjectNavItem,
  UrlNavItem as SpecUrlNavItem,
  ActionNavItem as SpecActionNavItem,
  ComponentNavItem as SpecComponentNavItem,
  DocNavItem as SpecDocNavItem,
  App as SpecApp,
} from '@objectstack/spec/ui';
import type { EvaluatedExpressionInput } from '@objectstack/spec/shared';
import type { BaseSchema } from './base.js';
import type { z } from 'zod';
import type { APP_SPEC_EXCLUDED, AppContextSelectorSchema } from './zod/app.zod.js';

// ============================================================================
// Unified Navigation Model (aligned with @objectstack/spec)
// ============================================================================

/**
 * Navigation item type — determines the target and required fields.
 *
 * The MEMBERSHIP list is the spec's, read off the discriminant of its nav-item
 * union rather than restated (#3177). A hand-written copy of a spec vocabulary
 * is the objectstack#4115 failure class — `ChartType` carried 7 of 19 members,
 * `ActionType` was missing `form` — and this one had drifted into an identical
 * nine-member copy that nothing checked.
 *
 * Deriving also makes a future spec addition LOUD instead of silent: exhaustive
 * consumers (`NAV_TYPE_META` in `plugin-designer`'s `NavigationDesigner` is a
 * `Record< NavigationItemType, … >`) stop compiling until the new variant is
 * handled, which is where a renderer gap belongs — not in a dead `default:`.
 */
export type NavigationItemType = SpecNavigationItem['type'];

/**
 * A navigation ENTRY — every {@link NavigationItem} except a separator.
 *
 * Supports typed navigation targets (object, dashboard, page, report, url),
 * nested groups, visibility expressions, RBAC permissions, and UX enhancements
 * like badges, pinning, and sort ordering.
 *
 * `type` excludes `'separator'`, so a separator can only be written through
 * {@link NavigationSeparatorItem} (objectui#10867).
 */
export interface NavigationEntryItem {
  /** Unique identifier */
  id: string;

  /** Navigation item type — any spec nav type except `'separator'`. */
  type: Exclude<NavigationItemType, 'separator'>;

  /**
   * Display label — the spec's `I18nLabel` (objectui#11299): a plain string, or
   * an inline locale map such as `{ en: 'Accounts', 'zh-CN': '客户' }`. A map
   * renders the viewer's locale entry, falling back through the spec's own
   * `resolveI18nLabel` order (`NavigationRenderer`'s `locale` prop).
   *
   * OPTIONAL since `@objectstack/spec` 17.5.0 (the cloud#2021 / objectui#9868
   * letter-A ruling), with the spec's declared semantic: **absent** ⇒ the entry
   * inherits, at RENDER time, the current label of what it opens — the view's
   * label when it names a labelled view, else the object's / dashboard's label,
   * else the target's machine name (`resolveNavItemLabel` in
   * `@object-ui/layout`); **present** ⇒ rendered as authored (a string verbatim,
   * a map as its entry for the viewer's locale). Nothing is stored for
   * the absent case, so a renamed target shows its new name on the next render.
   *
   * ⛔ Do not write `''` for "no label": an empty string is PRESENT, so it would
   * render empty text instead of inheriting — omit the key. `objectui validate`
   * refuses an empty label for that reason.
   */
  label?: I18nLabel;

  /** Icon name (Lucide) */
  icon?: string;

  // -- Type-specific target fields --

  /** Target object name (for type: 'object') */
  objectName?: string;

  /** Target view name (for type: 'object') — opens a specific named list view e.g. 'calendar', 'pipeline' */
  viewName?: string;

  /**
   * Target record id (for type: 'object') — when set, the nav item
   * opens a single record's detail page instead of a list view.
   *
   * Supports template variables resolved at render time by the shell:
   *   - `{current_user_id}` → currently signed-in user's id
   *   - `{current_org_id}`  → currently active organization's id
   *
   * If the template can't be resolved (e.g. signed-out pre-render),
   * the item falls back to opening the list view.
   *
   * When both `recordId` and `viewName` are set, `recordId` wins.
   */
  recordId?: string;

  /**
   * Record opening mode when `recordId` is set. Defaults to `'view'`.
   * Use `'edit'` to land directly on the edit form (e.g. "Edit my profile").
   *
   * Derived from the spec's own object-nav variant (#3177) — a restated
   * two-member enum is one spec release away from drifting.
   */
  recordMode?: NonNullable<SpecObjectNavItem['recordMode']>;

  /**
   * URL filter conditions (for type: 'object') — the entry targets the
   * parameterized bare data surface `/:objectName/data` with each entry
   * serialized as a `filter[<field>]=<value>` search param (equality),
   * instead of anchoring to a saved view. Use for one-off / parameterized
   * slices ("My open tickets" without authoring a view); slices worth
   * curating belong in a named view via `viewName`.
   *
   * Values support the same template variables as `recordId`
   * (`{current_user_id}`, `{current_org_id}`); entries whose template can't
   * be resolved are dropped from the URL.
   *
   * Mutually exclusive with `recordId` / `viewName` (objectui#8563): the
   * combination is REFUSED by `NavigationItemSchema`, which chains the spec's
   * own `objectNavTargetExclusivity`. There is deliberately no precedence to
   * resolve it with — an entry picks ONE landing, and the alternative is a
   * validator that silently ignores two of the three fields an author wrote.
   *
   * Shape derived from the spec's object-nav variant (#3177).
   */
  filters?: SpecObjectNavItem['filters'];

  /**
   * Auto-run deep link (for type: 'object') — the name of an action on the
   * target object that the list surface runs ONCE on arrival, through the same
   * execute path as a click (so param dialogs, confirms and entitlement gates
   * all still apply). Use for "take me straight into create" entries: a
   * welcome-page CTA that should land the user IN the create dialog rather than
   * on the list, hunting for a second button.
   *
   * Landing surface only: `runAction` describes the LIST surface, so combining
   * it with `recordId` is REFUSED by `NavigationItemSchema` (objectui#8563) — a
   * record detail page has no list toolbar for the action to run on. It composes
   * with `viewName` or `filters`. `NavigationRenderer.resolveHref` encodes it
   * as the reserved `?runAction=` search param — {@link NAV_RUN_ACTION_PARAM}
   * in `@object-ui/layout` is that param name's ONE definition, and the list
   * toolbar reads it back through the same constant.
   *
   * The reference is validated at AUTHORING time, not here: `defineStack`'s
   * cross-reference walk rejects a name no action declares ("deep-link
   * references action '…' (via runAction)"). A client that arrives holding a
   * name no action on the toolbar answers to runs nothing and — deliberately —
   * does not consume the param, so a reload with fresher metadata can still
   * honour it (the #4123 "arming is destructive" rule).
   *
   * Shape derived from the spec's object-nav variant (#3177); declared by
   * `ObjectNavItemSchema.runAction` since objectstack#7253.
   */
  runAction?: SpecObjectNavItem['runAction'];

  /** Target dashboard name (for type: 'dashboard') */
  dashboardName?: string;

  /** Target page name (for type: 'page') */
  pageName?: string;

  /** Target report name (for type: 'report') */
  reportName?: string;

  /** Target URL (for type: 'url') */
  url?: string;

  /**
   * Link target (for type: 'url').
   *
   * Derived from the spec's url-nav variant (#3177). The spec declares it
   * `.default('_self')`, so it is REQUIRED in that schema's output and optional
   * here — objectui reads a plain object and never parses, so the default is
   * never applied and the key is genuinely absent. `NonNullable` takes the
   * member list without importing that requiredness.
   */
  target?: NonNullable<SpecUrlNavItem['target']>;

  /**
   * Target component reference (for type: 'component') — a colon-joined
   * `ComponentRegistry` key (e.g. `metadata:resource`, `setup:permission_matrix`)
   * identifying a first-party UI shipped with the platform. Routed to
   * `/component/<ns>/<name>`. Mirrors `@objectstack/spec` `ComponentNavItem`.
   */
  componentRef?: string;

  /**
   * Extra parameters (for type: 'component' | 'page') — serialised as
   * querystring so the same component/page can be reused across nav entries
   * with different inputs (e.g. `params: { type: 'object' }`). String values
   * support the same template variables as `recordId`.
   *
   * Shape derived from the spec's component-nav variant (#3177); the page
   * variant declares the identical shape.
   */
  params?: SpecComponentNavItem['params'];

  /**
   * Book to open (for type: 'doc', ADR-0046) — a declared `book` name, or the
   * package id for the package's implicit book. Alone, the entry opens the book
   * at its first readable page; with {@link doc}, that page in this book's
   * context. At least one of `book` / `doc` is required on a `doc` entry — the
   * rule `NavigationItemSchema` takes from the spec's own `doc` arm
   * (objectui#11197). `NavigationRenderer.resolveHref` sends it to the console
   * docs portal.
   *
   * Derived from the spec's doc-nav variant (#3177).
   */
  book?: SpecDocNavItem['book'];

  /**
   * Doc to open (for type: 'doc', ADR-0046) — the doc NAME, i.e. its source
   * filename stem in lowercase snake_case (`crm_lead_guide`, never
   * `crm_lead_guide.md` or a path). Alone, its book context is the doc's own
   * book. Derived from the spec's doc-nav variant (#3177).
   */
  doc?: SpecDocNavItem['doc'];

  // -- Grouping --

  /** Child navigation items (for type: 'group') */
  children?: NavigationItem[];

  // -- Visibility & Permissions --

  /**
   * Visibility predicate — a CEL string, the spec's `{ dialect, source }`
   * envelope, or a boolean.
   *
   * The expression half is the spec's input type, `EvaluatedExpressionInput`,
   * by reference (objectui#13075) — the same type the zod twin
   * (`NavigationItemSchema`) takes by reference. Until then this was
   * `boolean | string`, which left out the envelope the spec's own parse
   * produces.
   *
   * The `boolean` arm is NOT derived (#3177): the spec admits it at neither
   * tier. `NavigationRenderer`'s `evalVis(item.visible)` honours the boolean,
   * and `menuItemToNavigationItem` produces one when mapping legacy
   * `AppMenuItem.hidden`. Pinned in `spec-derived-unions.test.ts`, which fails the
   * day the spec accepts a boolean and this can come off it.
   */
  visible?: boolean | EvaluatedExpressionInput;

  /** Required permissions to see/access this item */
  requiredPermissions?: string[];

  /**
   * One API data source whose bound value {@link visible} reads as `data` —
   * the spec's shared nav-item base member, by reference (objectui#12971).
   * The console reads it (objectui#13029): every navigation surface (the
   * sidebar, the `nav:menu` block, the command palette) reads the binding with
   * the signed-in fetch, and the entry is hidden while the read is pending,
   * after it fails, or when `path` selects nothing. Only `visible` reads
   * `data`; the label, the target and `children` do not.
   */
  dataSource?: SpecObjectNavItem['dataSource'];

  /**
   * Runtime capability gate — name of an object that must be registered
   * in the runtime's SchemaRegistry for this entry to render. Used to
   * hide cloud-only nav entries (e.g. `sys_app`, `sys_package`) in
   * single-project runtimes that don't register those objects.
   */
  requiresObject?: string;

  /**
   * Runtime capability gate — name of a kernel service that must be
   * registered for this entry to render. Mirrors `requiresObject` for
   * service-bound features.
   */
  requiresService?: string;

  // -- UX Enhancements --

  /** Badge text or count — derived from the spec's nav-item base (#3177). */
  badge?: NonNullable<SpecObjectNavItem['badge']>;

  /**
   * Badge visual variant — derived from the spec's own nav-item variant
   * rather than restated (objectstack#4115). The hand-written union this
   * replaces was missing `'secondary'`, so a spec-valid badge was a type
   * error here and was rejected outright by `objectui validate`.
   */
  badgeVariant?: NonNullable<SpecObjectNavItem['badgeVariant']>;

  /**
   * Whether a `type: 'group'` item starts expanded. This is the spec's
   * field name and the one to author against.
   */
  expanded?: boolean;

  /**
   * @deprecated Legacy objectui spelling of {@link expanded}. `NavigationRenderer`
   * honours whichever is set (`expanded` wins), so existing app metadata keeps
   * working; new metadata should use `expanded`.
   */
  defaultOpen?: boolean;

  /**
   * Action payload for `type: 'action'` items. Without it the item names an
   * action it cannot invoke — and before this was declared, `objectui validate`
   * silently stripped it, so a broken action item validated clean.
   *
   * Derived from the spec's action-nav variant (#3177). This is a structured
   * payload rather than a scalar, so a restatement is exactly the kind that
   * goes stale unnoticed — which is how it came to be stripped in the first
   * place (objectstack#4115).
   */
  actionDef?: NonNullable<SpecActionNavItem['actionDef']>;

  /**
   * Whether this item is pinned. objectui-only; the spec has no counterpart at
   * either tier, so NOT derived (#3177). `useNavPins` and `FavoritesProvider`
   * are built on it. Pinned in `spec-derived-unions.test.ts`, which fails the
   * day the spec claims the name — at which point the two meanings have to be
   * reconciled rather than silently shadowed.
   */
  pinned?: boolean;

  /** Sort order weight (lower = higher) */
  order?: number;
}

/**
 * A navigation SEPARATOR — a rule between entries, not an entry
 * (objectui#10867).
 *
 * It admits exactly the keys `@objectstack/spec`'s strict separator branch
 * declares: `type`, `id` and `order`. Every other {@link NavigationEntryItem}
 * key is `?: never` here, so writing one — a `label` above all — is a compile
 * error rather than a document the platform's `AppSchema` refuses at save
 * (`unrecognized_keys`). The `never` keys are DERIVED from
 * `NavigationEntryItem`, so a key added there is refused here without an edit.
 *
 * Reading one of them off an unnarrowed {@link NavigationItem} still compiles
 * and answers `undefined` on this arm, which is also what the object holds.
 *
 * `id` stays required, as on every objectui navigation item (the spec makes it
 * optional); a required `id` is still spec-valid. The agreement with the spec's
 * separator is asserted in `__tests__/spec-derived-unions.test.ts`.
 */
export type NavigationSeparatorItem = Pick<NavigationEntryItem, 'id' | 'order'> & {
  /** The separator discriminant. */
  type: 'separator';
} & {
  [K in Exclude<keyof NavigationEntryItem, 'id' | 'type' | 'order'>]?: never;
};

/**
 * Unified Navigation Item
 *
 * The single navigation primitive used across ObjectUI and @objectstack/spec.
 * Replaces the legacy `AppMenuItem` for application navigation trees.
 *
 * A union of two arms, discriminated by `type`: a {@link NavigationEntryItem}
 * (every spec nav type but `'separator'`) and a {@link NavigationSeparatorItem}
 * (objectui#10867). A separator has no `label`, and since objectui#9868 an
 * entry's `label` may be absent too (inherited from its target at render time —
 * see {@link NavigationEntryItem.label}), so display text comes from
 * `resolveNavItemLabel` in `@object-ui/layout`, never from a raw `item.label`
 * read.
 */
export type NavigationItem = NavigationEntryItem | NavigationSeparatorItem;

/**
 * Navigation Area — a business-domain partition of navigation items.
 *
 * Inspired by Salesforce Lightning App → Area → Tab model and
 * Microsoft Power Apps Area → Group → Subarea pattern.
 *
 * Each area contains an independent navigation tree, allowing large
 * enterprise applications to organise navigation by domain (e.g.
 * Sales, Service, Marketing).
 *
 * DERIVED from `@objectstack/spec/ui` (objectstack#4115): `id`, `label`,
 * `icon` and `description` flow in **by reference**, so a key the spec adds or
 * retypes cannot silently diverge here. The hand copy this replaces had already
 * lost `order` and `description` once (objectui#3088).
 *
 * `order`, `visible` and `requiredPermissions` were area-level keys until spec
 * 17.0.0 retired them (`AREA_VISIBLE_RETIRED` /
 * `AREA_REQUIRED_PERMISSIONS_RETIRED`): an area is a layout grouping, not an
 * access boundary — gate the navigation ITEM or the app instead.
 *
 * Worth stating plainly, because the retirement's own rationale says an area
 * "carries no gate of its own": objectui DID gate on them —
 * `AppSchemaRenderer`'s area switcher filtered areas by `visible` and
 * `requiredPermissions`. That filter is gone, and the gating it did now happens
 * one level down in `NavigationRenderer`, which is where the spec moved it.
 * The premise mismatch is recorded in objectui#3311. Per that issue's ruling,
 * area visibility is now DERIVED rather than authored: `AppSchemaRenderer`
 * hides an area from the switcher when none of its items survive the
 * item-level guards (`hasVisibleNavigationItems` in `@object-ui/layout`), so
 * the pre-17 "fully gated area disappears" UX is back without any authorable
 * area-level key.
 *
 * One key is pinned locally, for a reason that outlives a spec release:
 *
 *  - `navigation` — objectui's own {@link NavigationItem}, not the spec's.
 *    Spec 17.0.0-rc.1 gave the spec's item a real type, so this is no longer
 *    the `any` erasure objectstack#4171 was filed about — and it is still not
 *    bindable, for the reasons the module header above records
 *    (`visible: boolean`, `pinned` / `defaultOpen`; the separator `label` was
 *    closed by objectui#10867). Precision is not equivalence: this is case 2c in the guard's
 *    header, and the umbrella verdict lives with the element type in
 *    `__tests__/spec-derived-unions.test.ts`, which is where the blockers are
 *    pinned one by one.
 *
 * Drift guard: `__tests__/page-nav-misc-spec-parity.test.ts`.
 */
export interface NavigationArea extends Omit<SpecNavigationArea, 'navigation'> {
  /** Navigation items within this area (see the `navigation` note above). */
  navigation: NavigationItem[];
}

// ============================================================================
// Application Schema
// ============================================================================

/**
 * Top-level Application Configuration (app.json)
 *
 * ## The spec half is taken BY REFERENCE (objectui#9736)
 *
 * Its zod mirror (`zod/app.zod.ts` `AppComponentSchema`) has long been
 * `BaseSchema.extend(SpecAppFields.shape).extend({…})`: every key
 * `@objectstack/spec/ui`'s `AppSchema` declares flows into the published
 * validator by reference. This interface used to restate only the subset the
 * renderers read, so the published validator admitted keys the published type
 * did not declare — the package-lock envelope (`_lock*` / `_package*` /
 * `_provenance`, written by the packaging pipeline, never by an author),
 * `protection`, `isDefault`, `_unpublished`, `defaultAgent` — and the spec's
 * retirement tombstones (`version`, `homePageId`, `objects`, `apis`,
 * `sharing`, `embed`, `mobileNavigation`, `aria`) reached this type only as
 * `any` through `BaseSchema`'s index signature.
 *
 * Now both faces project the SAME spec surface: this interface extends
 * `Omit< App, … >` over `APP_SPEC_EXCLUDED`, the one `as const` array the
 * mirror's `specFieldsExcept` call also reads. A key the spec adds on the next
 * pin bump reaches both faces together; a key it retires with `retiredKey()`
 * surfaces here as an optional member typed `undefined`, so authoring a value
 * is a compile error — the verdict the validator gives at parse.
 *
 * The members this interface writes itself override the spec's where both
 * exist (`icon`, `branding`, `active`, `hidden`, `requiredPermissions`), and
 * each is assignable to the spec's type, so nothing beyond the shared list is
 * omitted. The three keys the shared list withholds from the spec projection
 * (`navigation` / `areas` / `contextSelectors`) are declared below with the
 * same local element types the mirror re-adds; `name` / `label` /
 * `description` are the component envelope.
 *
 * Pinned by `__tests__/twins-spec-by-reference-9736.test.ts`; the key-level
 * reconciliation is the `MirroredUndeclared` ledger in
 * `__tests__/zod-mirror-parity.test.ts`, which has no row for this pair.
 */
export interface AppComponentSchema extends BaseSchema, Omit<SpecApp, (typeof APP_SPEC_EXCLUDED)[number]> {
  type: 'app';
  
  /**
   * Application Name (System ID)
   */
  name?: string;

  /**
   * Display Title
   */
  title?: string;

  /**
   * Display Label (used in navigation and app switcher).
   *
   * `string | I18nLabel` — the spec's INLINE locale map (`string |
   * Record<string, string>`), resolved against a BCP-47 display locale by the
   * spec's own `resolveI18nLabel(label, locale)`.
   *
   * This restated the key as a plain `string` until objectui#9092. That was
   * narrower than BOTH faces it sits between: `BaseSchema.label` (which
   * objectui#4580's revised Q1 ruling, option A, widened to
   * `string | I18nLabel`) and this pair's own mirror — `zod/app.zod.ts`'s
   * `AppComponentSchema` never restates `label`, so it inherits the zod
   * `BaseSchema`'s `I18nLabelSchema`. A restatement is a NARROWING override,
   * so the mirror accepted an authored locale map and `tsc` refused it, with
   * the narrowing on the DECLARED side where a forward mirror-vs-declaration
   * comparison reads it as clean.
   *
   * ⚠️ NOT the KEYED vocabulary. {@link BaseSchema.ariaLabel} declares
   * `string | KeyedI18nLabel` (`{ key, defaultValue?, params? }`, resolved by
   * `resolveKeyedI18nLabel`) — objectui#4580 Q2-B withdrew the `I18nLabel`
   * spelling there as measured-wrong. The two object shapes are structurally
   * confusable to a READER, but neither vocabulary admits the other:
   * `InlineLocaleMapSchema` types its map with `key?: never; defaultValue?:
   * never`, and its `INLINE_LOCALE_KEY` pattern excludes both names, so writing
   * one into the other's slot is refused at `tsc` AND at parse. Asserted both
   * ways in `__tests__/inline-locale-declared-face-9092.test.ts`; an earlier
   * draft of this docblock said the two shapes "each accept the other
   * vacuously", which was true when objectui#4580 Q2-B wrote it and is false
   * against the installed pin. What a wrong slot costs is a wrong ANSWER rather
   * than a silent acceptance — `resolveI18nLabel` hands a keyed reference back
   * as its own `key` string — so still check which resolver owns a slot before
   * writing an object into it.
   */
  label?: string | I18nLabel;

  /**
   * Application Description
   */
  description?: string;

  /**
   * Icon name (Lucide) for app switcher and navigation
   */
  icon?: string;

  /**
   * ⛔ RETIRED — REFUSED BY NAME (objectui#10827, ADR-0049). The app logo is
   * {@link BrandingConfig.logo}: write `branding: { logo: '/logo.svg' }`.
   *
   * `@objectstack/spec`'s `AppSchema` never declared a top-level `logo`: its
   * alias table answers the key with "did you mean `branding`?", and its
   * `AppBrandingSchema` declares `logo` as a URL. This member was an
   * objectui-only second spelling, typed "Logo URL or icon name", that only
   * `AppSchemaRenderer`'s default sidebar header and the standalone runner read.
   * Both now read `branding.logo` as an image URL, and take an icon NAME from
   * {@link AppComponentSchema.icon}, the key the rest of the shell already reads.
   *
   * A tombstone rather than a deletion: the mirror's `.passthrough()` would
   * otherwise KEEP an authored value in silence, and so did `BaseSchema`'s
   * index signature until objectui#8347 (a widened value still would).
   * `?: never` is the twin of `zod/app.zod.ts`'s `aliasKeyRefusal` arm; the pin
   * is `__tests__/app-logo-one-spelling-10827.test.ts`.
   *
   * @deprecated Not a key of this contract. Author `branding.logo`.
   */
  logo?: never;

  /**
   * ⛔ RETIRED — REFUSED BY NAME (objectui#10842, the objectui#10827
   * one-spelling rule). The app favicon is {@link BrandingConfig.favicon}:
   * write `branding: { favicon: '/favicon.ico' }`.
   *
   * `@objectstack/spec`'s `AppSchema` never declared a top-level `favicon`: it
   * refuses the key (`unrecognized_keys`), and its `AppBrandingSchema` declares
   * `favicon` as a URL. The console already reads only `branding.favicon`
   * (`ConsoleLayout` hands it to `AppShell`); `AppSchemaRenderer` now does too.
   *
   * A tombstone rather than a deletion, for the reason `logo` above gives. The
   * twin is `zod/app.zod.ts`'s `aliasKeyRefusal` arm; the pin is
   * `__tests__/app-declared-keys-10842.test.ts`.
   *
   * @deprecated Not a key of this contract. Author `branding.favicon`.
   */
  favicon?: never;

  /**
   * ⛔ REFUSED BY NAME (objectui#11363). The mobile navigation mode is not a
   * key of the app document. Set the `mobileNavMode` prop of
   * `AppSchemaRenderer` (`@object-ui/layout`), or the `mobileNavMode` key of an
   * `app-schema-renderer` node: `'drawer'` (the default) or `'bottom_nav'`.
   *
   * `@objectstack/spec`'s `AppSchema` never declared it and refuses it
   * (`unrecognized_keys`), and `AppSchemaRenderer` reads only its prop, so a
   * document carrying the key drew no bottom bar and said nothing. Before this
   * member the key reached this type only as `any`, through `BaseSchema`'s
   * index signature.
   *
   * A tombstone rather than an absent key, for the reason `logo` above gives.
   * `?: never` is the twin of `zod/app.zod.ts`'s `retirementTombstone` arm; the
   * pin is `__tests__/app-mobile-nav-mode-refusal-11363.test.ts`.
   *
   * @deprecated Not a key of this contract. Set the `AppSchemaRenderer` prop or
   * the `app-schema-renderer` node key.
   */
  mobileNavMode?: never;

  /**
   * Branding configuration
   */
  branding?: BrandingConfig;

  /**
   * Whether the application is active (visible in app switcher)
   * @default true
   */
  active?: boolean;

  /**
   * Whether the app is hidden from the App Switcher -- the spec's
   * APP-CATALOGUE flag, NOT the renderer's hide predicate (objectui#7542).
   *
   * On every other node `hidden` is the key `BaseSchema` declares:
   * `boolean | ExpressionWire`, a predicate `SchemaRenderer`'s `shouldHide`
   * chain evaluates. On the `app` node a DIFFERENT key with the same name
   * wins: `@objectstack/spec/ui` `AppSchema.hidden`, taken BY REFERENCE
   * through `SpecAppFields` in `./zod/app.zod.ts`, where the spec's fields
   * land after the base's and override them. Measured on
   * `@objectstack/spec@17.2.0` by resolving `AppSchema.shape`: `hidden` is
   * `z.boolean().optional()`, described "Hide from the App Switcher; the
   * shell surfaces hidden apps via the avatar menu instead (navigation only
   * -- never an access gate)"; the spec declares NEITHER `visible` NOR
   * `disabled` on the app node, which is why the objectui#4581 / #4580
   * widenings of those two keys reached this node and the objectui#7455
   * widening of this one did not.
   *
   * So the predicate spelling every other node accepts -- a string, or the
   * CEL envelope object -- is REFUSED on this node on both faces: measured
   * before this restatement, `AppComponentSchema.safeParse({ type: 'app',
   * hidden: 'user.role == "admin"' })` failed at path `hidden`
   * (`invalid_type`, expected boolean, received string) and so did
   * `safeValidateSchema` on the same document, while this interface still
   * inherited the base's union and INVITED exactly that spelling. This member
   * pulls the declaration back to what the validator has enforced all along
   * (direction 1 of objectui#7542); the `KnownDrift` row objectui#7455 seeded
   * for this pair left with it, because the drift did. The in-repo reader
   * agrees with the boolean: `filterActiveApps`
   * (`packages/app-shell/src/utils/appRoute.ts`) keeps an app out of the
   * launcher on `hidden !== true` and never evaluates the value, so a
   * predicate string here would have read as "not hidden" without a sound.
   *
   * The open alternative is direction 2 -- give the catalogue flag its own
   * name upstream in `@objectstack/spec` so this node can inherit the
   * renderer's predicate again. That is a protocol change with its own
   * producers and is NOT taken here; until it is, an `app` node cannot use
   * the predicate spelling. Pinned by
   * `__tests__/app-hidden-catalogue-flag-7542.test.ts`.
   *
   * @example true
   */
  hidden?: boolean;

  /**
   * Global Layout Strategy
   * - sidebar: Standard admin layout with left sidebar
   * - header: Top navigation bar only
   * - empty: No layout, pages are responsible for their own structure
   * @default "sidebar"
   */
  layout?: 'sidebar' | 'header' | 'empty';

  /**
   * Global Navigation Menu
   * @deprecated Use `navigation` instead. Retained for backward compatibility.
   */
  menu?: AppMenuItem[];

  /**
   * Unified navigation tree (aligned with @objectstack/spec NavigationItem model).
   * Takes precedence over `menu` when both are present.
   */
  navigation?: NavigationItem[];

  /**
   * Navigation areas / business-domain partitions.
   * When provided, the sidebar displays an area switcher and renders
   * the selected area's navigation tree.
   */
  areas?: NavigationArea[];

  /**
   * App-level scope dropdowns (sidebar / topbar), whose selected value is
   * injected into navigation items as a `{<id>}` template var.
   *
   * Withheld from the spec projection by `APP_SPEC_EXCLUDED` because the
   * mirror re-adds it with its own element schema (`AppContextSelectorSchema`,
   * whose `label` also takes objectui's i18n label envelope), so this member
   * takes that element BY REFERENCE (objectui#9736) rather than restating it —
   * the two faces read one declaration.
   */
  contextSelectors?: Array<z.input<typeof AppContextSelectorSchema>>;

  /**
   * ⛔ RETIRED — REFUSED BY NAME (objectui#7469, maintainer ruling C, ADR-0049
   * enforce-or-remove).
   *
   * `actions` was an objectui-only array of free-form header buttons and a user
   * menu (`AppAction`, retired with it). The platform's `@objectstack/spec`
   * `AppSchema` is strict and has no `actions` member, so a server-served app —
   * the console's only source — could never carry one; only the standalone
   * runner drew it, and its buttons declared no behaviour to run. The ruling
   * keeps ONE channel for app-level actions: a {@link NavigationItem} of
   * `type: 'action'` whose `actionDef.actionName` names a declared `action`
   * (the console sidebar dispatches it), e.g.
   * `navigation: [{ id: 'quick_create', type: 'action', label: 'Quick Create',
   * actionDef: { actionName: 'quick_create' } }]`. The signed-in user's menu is
   * the host's, not app metadata.
   *
   * A tombstone rather than a deletion: the mirror's `.passthrough()` would
   * otherwise KEEP an authored array in silence, and so did `BaseSchema`'s
   * index signature until objectui#8347 (a widened value still would).
   * `?: never` is the twin of `zod/app.zod.ts`'s `retirementTombstone` arm; the
   * pin is `__tests__/app-actions-retired-7469.test.ts`.
   *
   * @deprecated Not a key of this contract. Author `navigation` items of
   * `type: 'action'`.
   */
  actions?: never;

  /**
   * Required permissions (ObjectStack Spec v2.0.1)
   * Permissions required to access this application
   */
  requiredPermissions?: string[];
}

/**
 * `app-schema-renderer` — the whole-shell node `@object-ui/layout` registers:
 * the TypeScript twin of `zod/app.zod.ts`'s `AppSchemaRendererNodeSchema`
 * (objectui#11515).
 *
 * The zod arm landed first (objectui#11440, `schema` by objectui#11494) with
 * no declaration here, so no TypeScript type named the node. This interface
 * declares the registration's three `inputs`, member for member with the arm:
 *
 *  - `schema` — the app document the shell draws, nested, as
 *    {@link AppComponentSchema} itself: the arm's member IS
 *    `AppComponentSchema`, the same schema object, so this one is its twin
 *    declaration. Its `type` is `'app'`, and its own refusals hold inside it
 *    (`mobileNavMode` there is refused, objectui#11363).
 *  - `basePath` — the prefix of every href the shell generates.
 *  - `mobileNavMode` — `'drawer'` (the default) or `'bottom_nav'`, the two
 *    modes the renderer implements. On this node it is the mode; on the app
 *    document it is refused.
 *
 * Neither content channel is read, so both are refused by name, the twin of
 * the arm's two `retirementTombstone` members (objectui#9256).
 *
 * The parity pair is `app.zod.ts#AppSchemaRendererNodeSchema` in
 * `__tests__/zod-mirror-parity.test.ts`. `@object-ui/layout`'s
 * `AppSchemaRendererProps` stays the component's prop type.
 */
export interface AppSchemaRendererNodeSchema extends BaseSchema {
  type: 'app-schema-renderer';
  /** The app document the shell draws (branding, `navigation`, `areas`), nested. */
  schema?: AppComponentSchema;
  /** URL prefix for the hrefs the shell generates (for example `/apps/crm`). */
  basePath?: string;
  /**
   * Mobile navigation mode: `'drawer'` (the default) puts the sidebar in the
   * mobile sheet overlay; `'bottom_nav'` also renders a fixed bottom bar.
   */
  mobileNavMode?: 'drawer' | 'bottom_nav';
  /**
   * REFUSED BY NAME (objectui#9256) — `app-schema-renderer` reads neither
   * content channel: `SchemaRenderer` strips both out of the props it hands
   * `AppSchemaRenderer`, and the component reads neither off the node.
   *
   * @deprecated Not a channel `app-schema-renderer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256), for the reason `body` gives.
   *
   * @deprecated Not a channel `app-schema-renderer` reads — nothing renders it.
   */
  children?: never;
}

// ============================================================================
// Legacy AppMenuItem (backward compat — prefer NavigationItem)
// ============================================================================

/**
 * Navigation Menu Item
 * @deprecated Use `NavigationItem` instead.
 */
export interface AppMenuItem {
  /**
   * Item Type
   */
  type?: 'item' | 'group' | 'separator';

  /**
   * Display Label
   */
  label?: string;

  /**
   * Icon Name (Lucide)
   */
  icon?: string;

  /**
   * Target Path (Route)
   */
  path?: string;

  /**
   * External Link
   */
  href?: string;

  /**
   * Child Items (Submenu)
   */
  children?: AppMenuItem[];

  /**
   * Badge / Count
   */
  badge?: string | number;

  /**
   * Visibility Condition
   */
  hidden?: boolean | string;

  /**
   * REFUSED (objectui#7719, director seat decision batch #70 of 2026-09-07,
   * maintainer verbatim 「同意」, in the objectui#6124 / ADR-0049 shape).
   *
   * `shortcut` is not authorable on this legacy menu item. The ruling refused
   * growing this deprecated type a `shortcut` member (zero measured pull, and
   * the type is being retired in favour of {@link NavigationItem}), and no
   * renderer reads a shortcut here. What it changed is the DIAGNOSTIC: an
   * authored value used to be stripped in silence by the zod mirror, and is now
   * refused by name there, with this face's `never` refusing it at the
   * authoring site before anything runs.
   *
   * The ruling was taken on the app action ITEMS (`AppAction.items`), the other
   * place this type was authored; objectui#7469 retired `AppAction` and its
   * `actions` array, so {@link AppComponentSchema.menu} is where an author meets
   * this refusal now. ⛔ The refusal itself is unchanged by that retirement.
   * Pinned in `__tests__/app-menu-item-shortcut-refusal-7719.test.ts`.
   *
   * @deprecated Not part of this contract — author the menu as a
   * {@link NavigationItem} and put the shortcut capability there.
   */
  shortcut?: never;
}

// ============================================================================
// AppMenuItem → NavigationItem Transform
// ============================================================================

/**
 * Convert a legacy `AppMenuItem` to a `NavigationItem`.
 * 
 * Mapping rules:
 * - `type: 'item'` → inferred from `href` (url) or `path` (page)
 * - `type: 'group'` → `type: 'group'`
 * - `type: 'separator'` → `type: 'separator'` (its `label` is dropped: the spec
 *   separator declares none, objectui#10867)
 * - `hidden` → `visible` (inverted)
 * - `path` → `pageName` (last segment) or kept as-is for url
 * - `href` → `url` with `target: '_blank'`
 * - a missing (or empty) `label` stays ABSENT rather than becoming `''`
 *   (objectui#9868): absent is the spec's "inherit at render time", while `''`
 *   is a present label that renders empty text and fails `objectui validate`
 */
export function menuItemToNavigationItem(
  item: AppMenuItem,
  index: number = 0,
): NavigationItem {
  const id = `migrated_${index}`;

  if (item.type === 'separator') {
    // The spec's separator declares no `label` (objectui#10867); a legacy
    // separator's label has no place to go.
    return { id, type: 'separator' };
  }

  if (item.type === 'group') {
    return {
      id,
      type: 'group',
      ...(item.label ? { label: item.label } : {}),
      icon: item.icon,
      children: (item.children || []).map((child, i) =>
        menuItemToNavigationItem(child, index * 100 + i),
      ),
      visible: item.hidden !== undefined ? !item.hidden : undefined,
      badge: item.badge,
      defaultOpen: true,
    };
  }

  // Default: 'item' type — infer target from href / path
  if (item.href) {
    return {
      id,
      type: 'url',
      ...(item.label ? { label: item.label } : {}),
      icon: item.icon,
      url: item.href,
      target: '_blank',
      visible: item.hidden !== undefined ? !item.hidden : undefined,
      badge: item.badge,
    };
  }

  // Path-based item → treat as page navigation
  return {
    id,
    type: 'page',
    ...(item.label ? { label: item.label } : {}),
    icon: item.icon,
    pageName: item.path || '',
    visible: item.hidden !== undefined ? !item.hidden : undefined,
    badge: item.badge,
  };
}

// ============================================================================
// App Creation Wizard Types
// ============================================================================

/**
 * Wizard step identifier for app creation flow.
 */
export type AppWizardStepId = 'basic' | 'objects' | 'navigation' | 'branding';

/**
 * App wizard step definition.
 */
export interface AppWizardStep {
  /** Step identifier */
  id: AppWizardStepId;

  /** Display label */
  label: string;

  /** Step description */
  description?: string;

  /** Icon name (Lucide) */
  icon?: string;

  /** Whether the step is optional */
  optional?: boolean;
}

/**
 * Branding configuration for an application.
 */
export interface BrandingConfig {
  /** Logo URL or base64 data URI */
  logo?: string;

  /** Primary brand color (hex) */
  primaryColor?: string;

  /** Favicon URL */
  favicon?: string;

  /** Font family override */
  fontFamily?: string;
}

/**
 * Object selection entry for the wizard.
 */
export interface ObjectSelection {
  /** Object name (snake_case) */
  name: string;

  /** Display label (singular) */
  label: string;

  /** Plural display label — preferred for list-style nav entries (falls back to `label`) */
  pluralLabel?: string;

  /** Icon name (Lucide) */
  icon?: string;

  /** Whether this object is selected */
  selected: boolean;
}

/**
 * App creation wizard draft state — represents the in-progress
 * application configuration before it is finalized into an AppSchema.
 */
export interface AppWizardDraft {
  /** App name (snake_case, validated) */
  name: string;

  /** Display title */
  title: string;

  /** Description */
  description?: string;

  /** App icon name (Lucide) */
  icon?: string;

  /** Template to start from */
  template?: string;

  // No `layout` (objectui#10867): `@objectstack/spec`'s `AppSchema` declares no
  // app layout, no console surface reads one and nothing stores one, so the
  // wizard's Layout control persisted nothing and was removed with this member.

  /** Selected business objects */
  objects: ObjectSelection[];

  /** Navigation tree being built */
  navigation: NavigationItem[];

  /** Branding configuration */
  branding: BrandingConfig;
}

/**
 * Editor mode for the app designer.
 */
export type EditorMode = 'edit' | 'preview' | 'code';

/**
 * Validate an app name is snake_case.
 * Pattern: starts with lowercase letter, followed by lowercase letters/digits,
 * with optional underscore-separated segments (no trailing/leading/double underscores).
 */
export function isValidAppName(name: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
}

/**
 * Convert an AppWizardDraft to the app document the Studio saves.
 *
 * The output is a metadata DOCUMENT for `client.meta.saveItem('app', …)`, and
 * the door judges it with `@objectstack/spec`'s strict `AppSchema`. So it
 * carries only keys that schema declares (objectui#10842):
 *   - the draft's title is `label`, the spec's one spelling; the spec answers a
 *     `title` with "did you mean `title` → `label`?";
 *   - the logo and favicon travel in `branding` only (objectui#10827);
 *   - no `type`: that is the renderer-node discriminator of
 *     {@link AppComponentSchema}, not a key of the stored app;
 *   - no `layout`: the spec declares no app layout, and the draft carries
 *     none either (objectui#10867 removed the wizard's Layout control);
 *   - a separator in `navigation` carries only `type`, `id` and `order`, the
 *     spec separator's keys ({@link NavigationSeparatorItem}, objectui#10867).
 * The pin is `__tests__/app-declared-keys-10842.test.ts`, which parses this
 * output with the spec's own `AppSchema`.
 */
export function wizardDraftToAppSchema(
  draft: AppWizardDraft,
): Omit<SpecApp, 'navigation'> & { navigation: NavigationItem[] } {
  return {
    name: draft.name,
    label: draft.title,
    description: draft.description,
    icon: draft.icon,
    branding: draft.branding,
    navigation: draft.navigation,
  };
}
