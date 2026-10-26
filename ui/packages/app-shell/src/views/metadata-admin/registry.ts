// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataResourceRegistry — per-type overrides for the generic metadata
 * admin engine (Phase 3c).
 *
 * The engine drives all 27 metadata types from a single ListPage /
 * EditPage / HistoryPage shell. By default everything is rendered via
 * a JSONSchema-driven AutoForm (using the rich `/meta/types` registry
 * row's `schema` field). Specialised editors (ObjectManager,
 * FieldDesigner, ObjectViewConfigurator, PermissionMatrix, …) opt in
 * by calling `registerMetadataResource()` to override the default
 * components for their type.
 *
 * This keeps the contract for "add a new metadata type" trivial:
 *   1. Define its Zod schema in `packages/spec/src/<domain>/`.
 *   2. Add it to `DEFAULT_METADATA_TYPE_REGISTRY` (framework).
 *   3. Done. It shows up in the Setup app's Metadata Directory with
 *      a working list / create / edit / history out of the box.
 *
 * Conventions:
 *   • `primaryKey` defaults to `'name'` (the universal metadata
 *     short-name; ADR-0006).
 *   • `searchableFields` defaults to `['name','label','description']`.
 *   • `listColumns` defaults to inferring from primary + label.
 *   • `supportsHistory` defaults to true (every overlay goes through
 *     `sys_metadata_history`).
 */

import type { ComponentType, ReactNode } from 'react';

/**
 * Live field-to-field derivation rule used by the generic create form.
 * See {@link MetadataResourceConfig.createDerive}.
 */
export interface CreateDeriveRule {
  /** Source field path (top-level key in the draft). */
  from: string;
  /** Target field path (top-level key in the draft). */
  to: string;
  /**
   * Named transform applied to `from`'s value. Closed set on purpose:
   *
   *   - `slugify`     — "Sales Order" → `sales_order`. ASCII letters,
   *                     digits, and `_`; CJK / non-Latin scripts yield
   *                     empty (caller must enter `name` manually).
   *   - `plural-en`   — naive English plural ("Order" → "Orders",
   *                     "Box" → "Boxes", "Category" → "Categories").
   *                     Non-Latin inputs returned unchanged.
   *   - `titlecase`   — "sales_order" → "Sales Order".
   *   - `first-token` — strip everything past the first separator.
   */
  transform: 'slugify' | 'plural-en' | 'titlecase' | 'first-token';
  /**
   * When true (default), the rule stops firing once the user manually
   * edits the `to` field. Lets us auto-suggest a name and then get out
   * of the way as soon as the operator takes over.
   */
  untilUserEdits?: boolean;
}

export type MetadataDomain =
  | 'data'
  | 'ui'
  | 'automation'
  | 'ai'
  | 'system'
  | 'platform'
  | 'identity'
  | 'security'
  | 'other';

/**
 * One row in the registry — describes how the generic engine should
 * render and edit a metadata type. All fields are optional; sensible
 * defaults apply if a type isn't registered at all.
 */
export interface MetadataResourceConfig {
  /** Metadata type, e.g. 'view', 'flow', 'agent'. */
  type: string;
  /** Display label. Falls back to server-side label or the type id. */
  label?: string;
  /** Long-form description shown in the page hero. */
  description?: string;
  /** Lucide icon name (e.g. 'database', 'workflow'). */
  iconName?: string;
  /** Coarse grouping for the directory page. */
  domain?: MetadataDomain;
  /** Primary key field, default `'name'`. */
  primaryKey?: string;
  /** Fields searched by the free-text filter. Default `['name','label','description']`. */
  searchableFields?: string[];
  /**
   * Optional client-side list predicate — return `false` to HIDE a row
   * from the resource list page. Runs against the unwrapped item shape
   * after search / source / package filters. Use this to drop back-compat
   * or synthetic rows (e.g. `view` hides the bare aggregated container the
   * framework keeps for runtime dual-read, since its views are listed
   * individually as expanded ViewItems). Pure function; keep it cheap.
   */
  listFilter?: (item: Record<string, unknown>) => boolean;
  /**
   * What the list page asks the server to serve beside each item (the list
   * read's `include`). `'grants'` is the `position` list's holder count and
   * permission sets in force (objectstack#25333); the columns that read them
   * are this type's own `listColumns`. Omit for the plain list.
   */
  listInclude?: 'grants';

  /** Columns rendered in the list page. */
  listColumns?: Array<{
    key: string;
    label: string;
    /** Optional cell renderer. `value` is `item[key]`. */
    render?: (value: unknown, item: Record<string, unknown>) => ReactNode;
    /** Column width hint in CSS (e.g. `'180px'`, `'30%'`). */
    width?: string;
  }>;
  /**
   * Fully custom list page. When provided, the generic shell is bypassed.
   * Receives `{ type }`. Use this for ObjectManager, etc.
   */
  ListPage?: ComponentType<{ type: string }>;
  /**
   * Fully custom edit page. Receives `{ type, name }`.
   *
   * Use this when the bespoke editor replaces the JSONSchema form entirely
   * (e.g. PermissionMatrix grid).
   */
  EditPage?: ComponentType<{ type: string; name: string }>;
  /**
   * Fully custom create page. Receives `{ type }`.
   */
  CreatePage?: ComponentType<{ type: string }>;
  /** Fields hidden from the AutoForm (still serialised on save). */
  hiddenFields?: string[];
  /** Suggested form field order (top to bottom). */
  fieldOrder?: string[];

  // ── Create-mode protocol (Phase A: protocol-driven create) ──────────
  //
  // These hints let the GENERIC ResourceEditPage render a stripped-down
  // create form without each type having to ship a bespoke CreatePage
  // React component. The contract is purely declarative — paths into the
  // type's JSONSchema, plus a few well-known transforms — so adding a
  // type is a registry edit, not a code change.
  //
  // Rationale: most metadata types have one or two "identity" fields
  // (name, label, parent object) and 10–30 "content" fields (filters,
  // permissions, steps, encryption, …). The latter only make sense in
  // the bespoke designer that takes over on the edit page, so asking
  // for them up front is hostile to the user and gates the real work.

  /**
   * Field paths shown in the create form. Order is preserved.
   *
   * - When omitted, the engine falls back to: every `required` field
   *   from the JSONSchema, plus `name` and `label` if present.
   * - Fields not in this list are still sent on save (after
   *   `createDefaults` merge), they're just not asked for.
   *
   * Example: `['label', 'pluralLabel', 'name', 'description']`.
   */
  createFields?: string[];

  /**
   * Live derivation rules — typically used to auto-fill `name` from
   * `label` (slug) and an English plural from a singular label. Each
   * rule transforms the value at `from` and writes it to `to`. When
   * `untilUserEdits` is true (default) the rule stops firing once the
   * user edits the target field directly.
   *
   * Transforms are intentionally a small closed set so the contract
   * stays declarative — adding "smart" behavior should mean adding a
   * named transform here, not embedding code in registry entries.
   */
  createDerive?: CreateDeriveRule[];

  /**
   * Shallow-merged into the saved body before PUT. Use this for the
   * "empty content" shape that lets the user land in the designer
   * (e.g. `{ fields: {} }` for object, `{ sections: [] }` for page).
   */
  createDefaults?: Record<string, unknown>;

  /**
   * Optional body builder. When present, takes precedence over
   * `createDefaults`: receives the user's `createFields` draft and
   * returns the full body to PUT. Use this when the wire shape isn't
   * a flat merge — e.g. `view` nests user-picked `object` inside
   * `{ list: { data: { object } } }`, or `validation` picks the
   * variant's required fields based on `draft.type`.
   *
   * Returned body should include the `identityField` (defaults to
   * `name`) — the engine still re-injects it from the URL slug, but
   * having it in the body keeps things explicit.
   */
  createBuildBody?: (draft: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Async create-time body augmentation that needs runtime context the pure
   * {@link createBuildBody} can't reach — e.g. fetching another metadata item.
   * Its returned fields are merged into the create body AFTER `createBuildBody`
   * / `createDefaults`. Best-effort: errors are swallowed (the create still
   * proceeds with the un-augmented body). Used by `page` to seed a record
   * page's `regions` from the bound object's synthesized default detail page,
   * so authoring starts from the auto-generated layout instead of blank.
   */
  createSeed?: (
    draft: Record<string, unknown>,
    ctx: { client: any },
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Optional load-time normaliser: the wire item returned by the server
   * (`layered.effective` / a pending draft) → the draft shape the editor
   * (SchemaForm / inspector / preview) expects. Applied on initial load
   * AND after every save-refresh, so the editor always sees the canonical
   * draft shape. Must be a pure function and a no-op for shapes it does
   * not recognise. Pair with {@link fromDraft} for the save round-trip.
   *
   * Example: `view` unwraps an expanded ViewItem's `config` into the
   * `{ list | form }` family key the View inspector reads.
   */
  toDraft?: (item: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Optional save-time serialiser — the inverse of {@link toDraft}. The
   * editor draft → the wire shape PUT back to the server. Applied to the
   * body just before save (edit mode). Must be a pure function and a
   * no-op for drafts it does not recognise.
   */
  fromDraft?: (draft: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Optional schema override for create mode only. When present, the
   * engine uses this schema (instead of the server's edit schema) to
   * render the create form and validate the draft. The saved body still
   * goes through `createBuildBody` / `createDefaults`, so this schema
   * just describes the simplified create-time input.
   *
   * Use this for wrapper types like `view` whose top-level schema has
   * no flat identity fields (only `{list,form,listViews,formViews}`):
   * a `createSchema` lets us ask for `{name,label,object}` up front,
   * then `createBuildBody` wraps them into the right nested shape.
   */
  createSchema?: Record<string, unknown>;

  /**
   * The create writes the item LIVE instead of into the draft buffer, when no
   * package binding (`?package=`) is active (objectui#7611).
   *
   * For a type whose {@link EditPage} edits the live item and reads no draft —
   * the permission set's matrix editor outside a package. A create left in the
   * draft buffer is then a draft that page never reads: the editor opens an
   * empty set without the label the create named, saves its edits live, and
   * the draft stays pending, so a later Publish replaces every one of those
   * edits with the empty create body.
   */
  createLive?: boolean;

  /**
   * Field path used as the metadata's identity — the URL slug AND
   * the key on the saved body. Defaults to `'name'`. Override when
   * the spec uses a different identifier (e.g. `permission` uses `id`
   * in 7.1+). The engine reads the identity out of the draft / body
   * at that path and writes it back at save time, so URL routing
   * stays stable across types.
   */
  identityField?: string;

  /**
   * One-line copy shown above the create form. Defaults to a generic
   * "Create a new <type>". When set to the empty string, the hint row
   * is suppressed.
   */
  createHint?: string;
  /** Whether the type opts in to the history tab. Default true. */
  supportsHistory?: boolean;
  /**
   * Override the empty-state copy on the list page (e.g. "No views yet —
   * Studio's Page Designer creates these for you").
   */
  emptyStateHint?: string;
  /**
   * Fallback JSONSchema used by the generic SchemaForm when the
   * framework's `/meta/types` endpoint doesn't expose a `schema` field
   * for this type (most types today). This lets us deliver a usable
   * form-driven create/edit experience without first wiring full
   * Zod→JSONSchema generation in the framework registry.
   *
   * If the server registry DOES return a `schema`, this is ignored.
   */
  defaultSchema?: Record<string, unknown>;

  /**
   * Declares that items of this type are "anchored" to one or more
   * parent metadata types. The Related tab on the parent's edit page
   * lists every item that matches the anchor predicate.
   *
   * For example, registering `hook` with
   * `{ anchorType: 'object', match: (item, name) => item.object === name }`
   * makes every `hook` whose `object` field equals `account` show up in
   * the Account object's Related tab under a "Hooks" group.
   *
   * Multiple anchors are allowed (e.g. a field could anchor to both
   * `object` and `view`). The Related panel groups by anchored type.
   */
  anchors?: MetadataAnchor[];
}

/**
 * Anchor declaration — "items of type X are children of items of type Y
 * when this predicate matches". Used to power the Related tab.
 *
 * The predicate runs in the client against the unwrapped item shape
 * returned by `client.list(type)`. Keep it cheap (just property reads);
 * we evaluate it once per item per render.
 */
export interface MetadataAnchor {
  /** The parent metadata type whose Related tab should surface this. */
  anchorType: string;
  /**
   * Where the anchored items live.
   *   - 'list' (default): query `client.list(childType)` and filter with
   *     `match()`. Used for first-class metadata types (hooks, views, …).
   *   - 'embedded': items are stored inside the parent body itself
   *     (e.g. `object.fields[]`). `extract()` plucks the array; no
   *     network call is made.
   */
  source?: 'list' | 'embedded';
  /**
   * Returns true when the child `item` belongs to the parent identified
   * by `anchorName`. The default helper `byField('object')` covers the
   * common case of an explicit `object: 'foo'` reference. Required when
   * `source === 'list'` (the default); ignored for `'embedded'`.
   */
  match?: (item: Record<string, unknown>, anchorName: string) => boolean;
  /**
   * For `source: 'embedded'` only. Returns the embedded items array
   * given the fully-loaded parent body. Items should already carry a
   * `name` (or be normalised by the renderer).
   */
  extract?: (parentItem: Record<string, unknown>) => Array<Record<string, unknown>>;
  /**
   * Optional override for the group label shown on the Related panel.
   * Defaults to the child type's resolved label.
   */
  groupLabel?: string;
  /**
   * Optional icon override for the group header. Falls back to the
   * child type's registered icon.
   */
  iconName?: string;
  /**
   * Optional explicit ordering hint inside the Related panel. Lower
   * numbers float to the top. Defaults to 100 if unset.
   */
  order?: number;
  /**
   * For `source: 'embedded'` only. The metadata type whose schema /
   * form should drive the embedded item's editor. Defaults to the
   * synthetic `type` from the registration when omitted (which will
   * fall back to JSON view).
   *
   * Example: object.fields → `editAs: 'field'` so the embedded editor
   * pulls `field`'s schema + form from `/meta/types`.
   */
  editAs?: string;
  /**
   * For `source: 'embedded'` only. Dotted path inside the parent body
   * where the collection lives (e.g. `fields`, `validations`). Used by
   * the embedded editor to write the modified item back into the
   * parent on save.
   */
  embeddedPath?: string;
}

/**
 * Helper that returns a `match` reading a (possibly dotted) field path
 * from the item and comparing it to the anchor name.
 *
 *   anchorByField('object')                  // item.object === name
 *   anchorByField('data.object')             // item.data?.object === name
 *   anchorByField(['list.data.object',
 *                  'form.data.object'])      // either path matches
 */
export function anchorByField(
  paths: string | string[],
): MetadataAnchor['match'] {
  const list = (Array.isArray(paths) ? paths : [paths]).map((p) => p.split('.'));
  return (item, name) => {
    for (const segs of list) {
      let cur: unknown = item;
      for (const s of segs) {
        if (cur && typeof cur === 'object' && s in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[s];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur === name) return true;
    }
    return false;
  };
}

const REGISTRY = new Map<string, MetadataResourceConfig>();

/**
 * Register (or merge) an entry. Idempotent — re-registering with the
 * same `type` merges the new fields with any existing entry so that
 * bespoke editors (e.g. PermissionMatrixEditor) and generic-engine
 * defaults (e.g. `defaultSchema`) can be registered independently and
 * coexist. Explicit `undefined` values do not overwrite.
 */
export function registerMetadataResource(config: MetadataResourceConfig): void {
  const prev = REGISTRY.get(config.type);
  if (!prev) {
    REGISTRY.set(config.type, config);
    return;
  }
  const merged: MetadataResourceConfig = { ...prev };
  for (const [k, v] of Object.entries(config as unknown as Record<string, unknown>)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
  }
  REGISTRY.set(config.type, merged);
}

/** Look up an entry. Returns `undefined` when the type isn't registered. */
export function getMetadataResource(type: string): MetadataResourceConfig | undefined {
  return REGISTRY.get(type);
}

/** Snapshot of all registered entries (diagnostics; directory page). */
export function listMetadataResources(): MetadataResourceConfig[] {
  return Array.from(REGISTRY.values());
}

/**
 * Build the list of child types whose items can be "anchored to" a
 * parent type. Used by the Related tab to decide which `client.list`
 * calls to make.
 *
 * Returns an array of `{ type, anchor }` pairs, sorted by `anchor.order`
 * (lower first) and then by child type label for stable rendering.
 */
export function listAnchorsFor(
  parentType: string,
): Array<{ type: string; config: MetadataResourceConfig; anchor: MetadataAnchor }> {
  const hits: Array<{ type: string; config: MetadataResourceConfig; anchor: MetadataAnchor }> = [];
  for (const cfg of REGISTRY.values()) {
    if (!cfg.anchors?.length) continue;
    for (const a of cfg.anchors) {
      if (a.anchorType === parentType) hits.push({ type: cfg.type, config: cfg, anchor: a });
    }
  }
  hits.sort((a, b) => {
    const ao = a.anchor.order ?? 100;
    const bo = b.anchor.order ?? 100;
    if (ao !== bo) return ao - bo;
    const al = a.anchor.groupLabel ?? a.config.label ?? a.type;
    const bl = b.anchor.groupLabel ?? b.config.label ?? b.type;
    return al.localeCompare(bl);
  });
  return hits;
}

/**
 * Merge a registered config (if any) with server-side defaults from
 * `/meta/types`. Server fields win for label/description/domain
 * (the spec is source of truth); user-registered fields win for
 * everything else (UI behaviour).
 */
export function resolveResourceConfig(
  type: string,
  serverEntry?: {
    label?: string;
    description?: string;
    domain?: string;
    allowEnvironmentOverlay?: boolean;
  },
): MetadataResourceConfig & { allowEnvironmentOverlay?: boolean } {
  const registered = REGISTRY.get(type) ?? { type };
  return {
    ...registered,
    type,
    label: registered.label ?? serverEntry?.label ?? type,
    description: registered.description ?? serverEntry?.description,
    domain: (registered.domain ?? (serverEntry?.domain as MetadataDomain) ?? 'other'),
    allowEnvironmentOverlay: serverEntry?.allowEnvironmentOverlay,
    defaultSchema: registered.defaultSchema,
  };
}
