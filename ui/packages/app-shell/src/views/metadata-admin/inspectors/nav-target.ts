// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Nav-item target resolution (#2245) — the pure logic behind
 * AppNavInspector's type + per-type target editing.
 *
 * The nav contract is a discriminated union on `type`; each type carries its
 * own typed target field. `object` items additionally have FOUR mutually
 * exclusive landing modes matching resolveHref's precedence
 * (`recordId` → `filters` → `viewName` → bare default). The mode is NEVER
 * persisted — it is derived from which fields are present — and switching
 * type/mode explicitly clears the other target fields plus the legacy
 * off-spec keys (`path` / `kind` / aliases), so every edit normalizes the
 * item to spec shape ("edit is the migration").
 */

import type { NavigationItemType } from '@object-ui/types';

/**
 * Nav item types `AppNavInspector` (the Setup app editor) offers: six of the
 * spec union's members — not `action`, `component`, `doc` or `separator`. The
 * Studio's nav editor offers every member ({@link NAV_ENTRY_TYPES}).
 */
export const NAV_ITEM_TYPES = ['object', 'page', 'dashboard', 'report', 'url', 'group'] as const;
export type NavItemType = (typeof NAV_ITEM_TYPES)[number];

/**
 * Every `type` the spec's `NavigationItemSchema` declares, in the order the
 * Studio's nav editor offers them (objectui#11790).
 *
 * Keyed by the spec-derived `NavigationItemType` (`@object-ui/types` reads it
 * off the spec union's discriminant), so a member the spec adds or drops stops
 * this file compiling until the table follows: a `Record` must name every
 * member and a fresh literal may name no other. The runtime half, against the
 * INSTALLED spec's union, is pinned beside this file
 * (`nav-target.navEntryTypes-11790.test.ts`).
 */
const NAV_ENTRY_TYPE_TABLE: Record<NavigationItemType, true> = {
  object: true,
  page: true,
  dashboard: true,
  report: true,
  url: true,
  action: true,
  component: true,
  doc: true,
  group: true,
  separator: true,
};

/** The Studio nav editor's type list: exactly the spec's members ({@link NAV_ENTRY_TYPE_TABLE}). */
export const NAV_ENTRY_TYPES = Object.keys(NAV_ENTRY_TYPE_TABLE) as ReadonlyArray<NavigationItemType>;

/** Whether `value` names a member of the spec's nav-item union. */
export function isNavEntryType(value: unknown): value is NavigationItemType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NAV_ENTRY_TYPE_TABLE, value);
}

/**
 * The keys every nav entry but a separator declares: the spec's shared base,
 * which each target-bearing branch, and `group`, spreads. They describe the
 * entry, not what it opens, so a change of type keeps them.
 */
const NAV_ENTRY_BASE_KEYS = [
  'id',
  'label',
  'icon',
  'order',
  'badge',
  'badgeVariant',
  'visible',
  // The spec's base declares it since the objectstack `main` pin after
  // 18.0.0-next.3 (objectstack#24332): the API binding `visible` reads, so a
  // change of type keeps it beside `visible` (objectui#12971).
  'dataSource',
  'requiredPermissions',
  'requiresObject',
  'requiresService',
] as const;

/** A separator is a divider: it declares `type`, an optional `id` and `order`, and nothing else. */
const NAV_SEPARATOR_KEYS = ['id', 'order'] as const;

/**
 * Whether a nav editor offers the describing field `key` (its label, icon, …)
 * on an entry of `type` (objectui#11847): exactly when the spec's member for
 * that type declares it. Every member is strict, so a value typed into a field
 * the member does not declare is a key the save refuses (`unrecognized_keys`).
 * A separator declares only its `id` and `order`: neither Setup's app editor
 * (`AppNavInspector`) nor the Studio's nav inspector offers it a label or an
 * icon. Every other member declares the whole shared base.
 *
 * `null` is an entry with no type the spec declares (an untyped placeholder or
 * a legacy spelling). Neither editor turns one into a separator, so it is
 * offered the shared base, as before. The answer reads the same two tables
 * {@link retypedNavEntry} keeps on a change of type, so what a retype carries
 * and what the editors offer cannot drift apart; both are pinned against the
 * INSTALLED spec's members beside this file.
 */
export function navEntryOffersField(
  type: NavigationItemType | null,
  key: (typeof NAV_ENTRY_BASE_KEYS)[number],
): boolean {
  const declared: ReadonlyArray<string> = type === 'separator' ? NAV_SEPARATOR_KEYS : NAV_ENTRY_BASE_KEYS;
  return declared.includes(key);
}

/**
 * The members that accept `children`: an `object` entry nesting its views, and
 * a `group`, which requires them. Every other member refuses the key.
 */
const NAV_TYPES_WITH_CHILDREN: ReadonlySet<NavigationItemType> = new Set<NavigationItemType>(['object', 'group']);

/** Whether an entry of `type` may carry `children`. */
export function navTypeAcceptsChildren(type: NavigationItemType): boolean {
  return NAV_TYPES_WITH_CHILDREN.has(type);
}

/**
 * The entry a change of `type` leaves (objectui#11790): the keys the new type
 * declares, read off the old entry, and nothing else.
 *
 * Every member of the spec's union is strict, so a key the new type does not
 * declare is refused at save (`unrecognized_keys`). What the entry opened goes
 * (its target is the old type's), and the entry is unbound until a target is
 * picked: the save leaves it out until then and the editor keeps it in its
 * place (`navPayloadOf`, objectui#11776). What describes the entry stays — its
 * `id`, label, icon, gates and badge — except on a separator, which keeps only
 * its `id` and `order`. `children` stay on a type that accepts them, and a
 * `group` is born with an empty list, which its member requires. The same
 * `type` answers the entry unchanged.
 */
export function retypedNavEntry(
  entry: Record<string, unknown>,
  type: NavigationItemType,
): Record<string, unknown> {
  if (entry.type === type) return entry;
  const keep: ReadonlyArray<string> = type === 'separator' ? NAV_SEPARATOR_KEYS : NAV_ENTRY_BASE_KEYS;
  const next: Record<string, unknown> = {};
  if (entry.id !== undefined) next.id = entry.id;
  next.type = type;
  for (const key of keep) {
    if (key !== 'id' && entry[key] !== undefined) next[key] = entry[key];
  }
  if (NAV_TYPES_WITH_CHILDREN.has(type) && Array.isArray(entry.children)) next.children = entry.children;
  if (type === 'group' && !Array.isArray(next.children)) next.children = [];
  return next;
}

/** Landing modes for `type: 'object'`, in resolveHref precedence order. */
export const OBJECT_TARGET_MODES = ['default', 'view', 'record', 'filters'] as const;
export type ObjectTargetMode = (typeof OBJECT_TARGET_MODES)[number];

/**
 * Per-type target descriptor: which field the picker writes and which
 * metadata list feeds its options (`client.list(metaType)`); free-text
 * types have no metaType.
 */
export const NAV_TYPE_TARGETS: Record<
  NavItemType,
  { targetKey?: string; metaType?: string }
> = {
  object: { targetKey: 'objectName', metaType: 'object' },
  page: { targetKey: 'pageName', metaType: 'page' },
  dashboard: { targetKey: 'dashboardName', metaType: 'dashboard' },
  report: { targetKey: 'reportName', metaType: 'report' },
  url: { targetKey: 'url' },
  group: {},
};

/**
 * Whether a `page` metadata list row can back a `type: 'page'` nav item.
 *
 * Record-detail pages (`type: 'record'`) require a specific record id to
 * render, but a `type: 'page'` nav item resolves to a static
 * `/apps/{app}/page/{name}` URL with no mechanism to pass one — so linking one
 * from navigation is always broken at runtime (#2333). Exclude them from the
 * page picker. Mirrors usePageAssignment's record discriminator: `type` alone.
 * `pageType` is not read — `PageSchema` refuses it as an alias of `type`, so no
 * page that parses carries it (objectui#9674). Rows missing `type` are kept
 * (only a confirmed record page is excluded).
 */
export function isStaticPageOption(row: { type?: string }): boolean {
  return row.type !== 'record';
}

/** Typed target fields across the whole union. */
const TYPED_TARGET_FIELDS = [
  'objectName',
  'viewName',
  'recordId',
  'recordMode',
  'filters',
  'pageName',
  'dashboardName',
  'reportName',
  'url',
  'target',
  'params',
] as const;

/**
 * Legacy / off-spec keys that runtime resolution ignores and save-time
 * validation rejects. Cleared on EVERY inspector edit so stale keys never
 * hijack behavior or fail validation (`navigation.0: Invalid input`).
 */
const LEGACY_KEYS = ['path', 'kind', 'href', 'route', 'object', 'page', 'dashboard', 'report'] as const;

/**
 * Map a legacy `kind` value (the old inspector's vocabulary) to the spec
 * type; `link` was never a spec member — it maps to `url`.
 */
const LEGACY_KIND_TO_TYPE: Record<string, NavItemType> = {
  object: 'object',
  page: 'page',
  dashboard: 'dashboard',
  report: 'report',
  link: 'url',
  url: 'url',
  group: 'group',
};

/**
 * Infer the effective type of a (possibly legacy) nav node for display:
 * spec `type` wins; else legacy `kind`; else the presence of typed or
 * legacy target fields; else children ⇒ group; else null (unset).
 */
export function inferNavItemType(node: Record<string, unknown>): NavItemType | null {
  const t = node.type;
  if (typeof t === 'string' && (NAV_ITEM_TYPES as readonly string[]).includes(t)) {
    return t as NavItemType;
  }
  const kind = node.kind;
  if (typeof kind === 'string' && LEGACY_KIND_TO_TYPE[kind]) return LEGACY_KIND_TO_TYPE[kind];
  if (node.objectName || node.object) return 'object';
  if (node.pageName || node.page) return 'page';
  if (node.dashboardName || node.dashboard) return 'dashboard';
  if (node.reportName || node.report) return 'report';
  if (node.url || node.href) return 'url';
  if (Array.isArray(node.children) && node.children.length > 0) return 'group';
  const path = node.path;
  if (typeof path === 'string' && /^https?:/i.test(path)) return 'url';
  return null;
}

/**
 * Derive an object item's landing mode from field presence, following
 * resolveHref's precedence — the mode is a projection, never stored.
 */
export function deriveObjectTargetMode(node: Record<string, unknown>): ObjectTargetMode {
  if (node.recordId) return 'record';
  const filters = node.filters;
  if (filters && typeof filters === 'object' && !Array.isArray(filters)) return 'filters';
  if (node.viewName) return 'view';
  return 'default';
}

/**
 * The patch that clears everything EXCEPT the fields the given type+mode
 * legitimately owns. Always includes the legacy keys. Spread this before
 * the fields being set so a type/mode switch leaves no stale target behind.
 */
export function clearedTargetPatch(
  keep: ReadonlyArray<string> = [],
): Record<string, undefined> {
  const patch: Record<string, undefined> = {};
  for (const key of [...TYPED_TARGET_FIELDS, ...LEGACY_KEYS]) {
    if (!keep.includes(key)) patch[key] = undefined;
  }
  return patch;
}

/** Fields each object landing mode owns (besides objectName). */
export const OBJECT_MODE_FIELDS: Record<ObjectTargetMode, ReadonlyArray<string>> = {
  default: ['objectName'],
  view: ['objectName', 'viewName'],
  record: ['objectName', 'recordId', 'recordMode'],
  filters: ['objectName', 'filters'],
};

/**
 * Ensure a spec-valid snake_case `id`. Existing ids are kept; otherwise one
 * is derived from the target/label and uniqued against sibling ids.
 */
export function ensureNavId(
  node: Record<string, unknown>,
  siblings: ReadonlyArray<Record<string, unknown>>,
  seed?: string,
): string {
  const existing = node.id;
  if (typeof existing === 'string' && existing) return existing;
  const raw = (seed ?? String(node.objectName ?? node.label ?? 'item'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
  const base = `nav_${raw}`;
  const taken = new Set(
    siblings.map((s) => (typeof s.id === 'string' ? s.id : '')).filter(Boolean),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
