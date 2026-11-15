// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioCanvasPreviewRegistry — per-type canvas renderers for the Studio
 * design surface.
 *
 * Why a *second* registry alongside `MetadataPreviewRegistry`
 * (`../metadata-admin/preview-registry`): the SAME metadata type is rendered
 * differently depending on the SURFACE it appears in. An `object` in the Data
 * pillar (metadata-admin) is the field-form DESIGNER (`ObjectPreview` →
 * `ObjectFormCanvas`); an `object` in the Studio design canvas is the runtime
 * records GRID — schema editing belongs to the Data pillar, so the app-builder
 * canvas shows objects as the running app does, not a field editor.
 *
 * A single type-keyed registry can't express that `(type, surface)` split,
 * which is why the object branch used to be a hardcoded special-case inside
 * `StudioDesignSurface`. This registry is the missing surface dimension, scoped
 * to the Studio canvas: a sensible default is registered for `object` (below),
 * and downstream apps/plugins override it via `registerStudioCanvasPreview()`
 * without forking `StudioDesignSurface`.
 *
 * Resolution contract: if a type has no studio-canvas entry,
 * `getStudioCanvasPreview()` returns `undefined` and the surface falls back to
 * the generic `MetadataPreview` pipeline (`getMetadataPreview`) like every
 * other type. So this registry is purely additive — it only intercepts types
 * that opt in.
 *
 * NOTE (long-term): today only `object` needs a surface-specific override. If a
 * second surface ever needs per-type overrides, prefer folding this into a
 * `(type, surface)`-keyed lookup on the existing MetadataPreviewRegistry rather
 * than growing a third parallel registry.
 */

import * as React from 'react';
import { resolveHref, type NavTemplateContext } from '@object-ui/layout';
import type { NavigationEntryItem } from '@object-ui/types';
import type { ObjectNavItem } from '@objectstack/spec/ui';
import { parseUrlFilterTriples, type FilterTriple } from '../drillUrlFilters.js';
import { lazyPage } from '../../services/lazyPage.js';

/**
 * Props handed to a Studio-canvas renderer. Intentionally a small, read-only
 * subset of {@link MetadataPreviewProps}: the Studio canvas renders objects as
 * a runtime surface, not an editable draft (schema editing is the Data
 * pillar's job), so there is no `onPatch`/`selection` here.
 */
export interface StudioCanvasPreviewProps {
  /** The metadata type, e.g. 'object'. */
  type: string;
  /** The item's primary-key name (e.g. the object's API name). */
  name: string;
  /**
   * The live draft from the design surface. Treat as immutable and untrusted
   * (validation may be in progress). Provided for renderers that need config
   * beyond the name; the default object renderer only needs `name`.
   */
  draft: Record<string, unknown>;
  /** Optional BCP-47 locale code (e.g. 'en', 'zh-CN') for localized labels. */
  locale?: string;
}

export type StudioCanvasPreview = React.ComponentType<StudioCanvasPreviewProps>;

const REGISTRY = new Map<string, StudioCanvasPreview>();

/**
 * Register (or replace) the Studio-canvas renderer for a metadata type.
 * Idempotent and last-write-wins, so an app can swap the default from its
 * plugin bootstrap.
 */
export function registerStudioCanvasPreview(type: string, component: StudioCanvasPreview): void {
  REGISTRY.set(type, component);
}

/** Look up the registered Studio-canvas renderer for a type, if any. */
export function getStudioCanvasPreview(type: string): StudioCanvasPreview | undefined {
  return REGISTRY.get(type);
}

/** Snapshot of registered Studio-canvas types (diagnostics/tests). */
export function listStudioCanvasPreviewTypes(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

/**
 * The Interfaces nav entry the canvas is open on, as far as its list goes
 * (objectui#11774): an `object` entry's `filters` (a data slice) or `viewName`
 * (a named view), as authored, with the entry's `id`.
 *
 * ⛔ Studio-internal. A context and not a member of
 * {@link StudioCanvasPreviewProps}: those props are on the package entry, and
 * carrying an entry's modifiers to every registered canvas would widen that
 * published face. The Interfaces pillar provides it around the canvas it
 * renders; the built-in default below reads it. A canvas registered over the
 * default, or one rendered outside the pillar, sees `null` and renders as it
 * always did.
 */
export interface StudioCanvasNavEntry {
  navId?: string;
  filters?: ObjectNavItem['filters'];
  viewName?: ObjectNavItem['viewName'];
}

export const StudioCanvasNavEntryContext = React.createContext<StudioCanvasNavEntry | null>(null);

/**
 * The list view the Properties panel beside the canvas is editing
 * (objectui#11823), in the named-view shape `object-view` reads: the buffer
 * the panel saves to the package draft, unsaved edits included.
 *
 * ⛔ Studio-internal, for the reason {@link StudioCanvasNavEntry} is: a
 * context beside the published props, never a member of
 * {@link StudioCanvasPreviewProps}. The Interfaces pillar provides it while
 * its panel holds a view for the open `object` leaf; a canvas rendered
 * outside the pillar, or a leaf whose view does not exist yet, sees `null`
 * and renders as it did before.
 */
export interface StudioCanvasListView {
  /** The object the view lists. The canvas uses the view only for this object. */
  objectName: string;
  /** The view item's name, `<object>.<key>`. */
  viewId: string;
  /** The view's list body, as a named view of `object-view`'s `listViews`. */
  view: Record<string, unknown>;
}

export const StudioCanvasListViewContext = React.createContext<StudioCanvasListView | null>(null);

/**
 * The column selection of the list view the Properties panel edits
 * (objectui#12725): which of the view's listed columns a header click on the
 * canvas can select, which one is selected, and how to select one.
 *
 * Target 2 of objectui#12725: a click on a canvas element shows that
 * element's properties. On an `object` leaf the element is a column, and its
 * properties are its row in the panel's column list, so a click on a header
 * the view lists selects that row. A header the view does not list (no row to
 * select) keeps the runtime's click, which sorts.
 *
 * ⛔ Studio-internal, for the reason {@link StudioCanvasNavEntry} is: a
 * context beside the published props, never a member of
 * {@link StudioCanvasPreviewProps}. The Interfaces pillar provides it while
 * its panel lists the open leaf's columns. A canvas registered over the
 * default does not read it, and one rendered outside the pillar sees `null`;
 * either way its headers sort as the running app's do.
 */
export interface StudioCanvasColumnSelection {
  /** The object the view lists. Headers are read only on this object's canvas. */
  objectName: string;
  /** The field each listed column shows, in the view's order. */
  fields: readonly string[];
  /** The selected column's field, or `null` with none selected. */
  selected: string | null;
  /** Select the column showing `field`; `label` is the header as drawn. */
  onSelect: (field: string, label: string) => void;
}

export const StudioCanvasColumnSelectionContext = React.createContext<StudioCanvasColumnSelection | null>(null);

/**
 * The card selection of the kanban view the Properties panel edits
 * (objectui#12725): a click on a card of the board selects "the card", whose
 * properties are the panel's kanban card section (the board's card, not one
 * record), and the clicked card is outlined.
 *
 * ⛔ Studio-internal, for the reason {@link StudioCanvasNavEntry} is: a
 * context beside the published props, never a member of
 * {@link StudioCanvasPreviewProps}. The Interfaces pillar provides it while
 * its panel holds a kanban view of the open leaf. A canvas registered over the
 * default does not read it, and one rendered outside the pillar sees `null`;
 * either way a card click opens the record as the running app's does.
 */
export interface StudioCanvasCardSelection {
  /** The object the board lists. Cards are read only on this object's canvas. */
  objectName: string;
  /** The record id of the card outlined, or `null` with none selected. */
  selected: string | null;
  /** Select the card; `id` is the clicked card's record id. */
  onSelect: (id: string) => void;
}

export const StudioCanvasCardSelectionContext = React.createContext<StudioCanvasCardSelection | null>(null);

/**
 * Which of the package's objects have only a draft (a pending draft, no
 * published row), as the Interfaces pillar knows them under the publish the
 * canvas shows (objectui#12508).
 *
 * Preview = runtime: such an object has no runtime yet. The server answers
 * 404 for its schema (`/meta/object/NAME`) and for its records
 * (`/data/NAME`), so the canvas does not mount the records grid for it.
 *
 *  - `pending`: the pillar's read for the current publish has not answered
 *    yet. An answer read under an earlier publish is not used: that publish
 *    may have just made the object live.
 *  - `known`: the names, read under the current publish.
 *
 * ⛔ Studio-internal, for the reason {@link StudioCanvasNavEntry} is. A
 * canvas rendered outside the pillar sees `null` and renders as it always did.
 */
export type StudioCanvasDraftOnlyObjects =
  | { status: 'pending' }
  | { status: 'known'; names: ReadonlySet<string> };

export const StudioCanvasDraftOnlyObjectsContext = React.createContext<StudioCanvasDraftOnlyObjects | null>(null);

/** What an entry changes about the object's list: the slice's conditions, or the named view to open. */
export interface NavEntryListTarget {
  /** The entry's `filters` as the `/data` surface reads them; empty when it lands elsewhere. */
  filter: FilterTriple[];
  /** The view the entry lands on (`/view/:viewId`), as the entry names it; absent otherwise. */
  viewName?: string;
}

/**
 * Where the running app takes an `object` nav entry, read the way the route it
 * lands on reads it (objectui#11774). The preview asks the runtime rather than
 * interpreting `filters` / `viewName` a second time:
 *
 *  - `resolveHref` (`@object-ui/layout`) is the shell's single source of truth
 *    for nav → URL. It decides the landing — `recordId` → `filters` →
 *    `viewName` — and substitutes `{current_user_id}`-style values, dropping
 *    an entry it cannot resolve, as the sidebar does;
 *  - a `/data` landing is the bare data surface, whose `filter[...]` params
 *    `ObjectDataPage` reads through `parseUrlFilterTriples` — read here by the
 *    same function;
 *  - a `/view/:viewId` landing names the view `ObjectView` opens; the caller
 *    matches it as `ObjectView` does (`resolveViewId`).
 *
 * Any other landing (the plain list, a `recordId` detail page) changes nothing
 * here, so such an entry previews the object's list as before.
 */
export function navEntryListTarget(
  objectName: string,
  entry: StudioCanvasNavEntry | null,
  templateContext?: NavTemplateContext,
): NavEntryListTarget {
  if (!entry || (!entry.filters && !entry.viewName)) return { filter: [] };
  // The question is where an entry with these modifiers lands; `resolveHref`
  // reads no `id` off an object entry, so the id is carried only for the type.
  const item: NavigationEntryItem = {
    id: entry.navId ?? '',
    type: 'object',
    objectName,
    ...(entry.filters ? { filters: entry.filters } : {}),
    ...(entry.viewName ? { viewName: entry.viewName } : {}),
  };
  const { href } = resolveHref(item, '', templateContext);
  const q = href.indexOf('?');
  const route = (q < 0 ? href : href.slice(0, q)).slice(`/${objectName}`.length);
  if (route === '/data') {
    return { filter: parseUrlFilterTriples(new URLSearchParams(q < 0 ? '' : href.slice(q + 1))) };
  }
  const VIEW = '/view/';
  if (route.startsWith(VIEW) && route.length > VIEW.length) {
    return { filter: [], viewName: route.slice(VIEW.length) };
  }
  return { filter: [] };
}

/** An object definition's merged `listViews` map, or `{}` when it has none. */
export function listViewsOf(def: { listViews?: unknown } | undefined): Record<string, unknown> {
  const views = def?.listViews;
  return views && typeof views === 'object' ? (views as Record<string, unknown>) : {};
}

/**
 * Default Studio-canvas renderer for `object` leaves: the runtime records grid
 * (`./studio-object-records-canvas.tsx`, whose header says what it draws).
 *
 * Registered BY REFERENCE to its module (objectstack#33582). The package entry
 * imports this module for its load-time registration (it is in the package's
 * `sideEffects`), so the grid by value held its imports, the designer strings
 * among them (`metadata-admin/i18n.ts` and the Studio `en` string namespace),
 * in the console's EAGER closure on every route. The grid now loads the first
 * time a Studio canvas draws an `object` leaf.
 *
 * Exported so downstream renderers can compose/wrap it, and so a surface can
 * tell the default from an override by identity: this value, not the module's
 * own function, is the one registered. Override the default wholesale via
 * `registerStudioCanvasPreview('object', …)`.
 */
export const StudioObjectRecordsCanvas: StudioCanvasPreview = lazyPage('studio canvas', () =>
  import('./studio-object-records-canvas.js').then((m) => m.StudioObjectRecordsCanvas),
);

// Side-effect: register the built-in defaults. Kept inline (rather than a
// separate `previews/` folder like metadata-admin) because there is exactly one
// default; downstream overrides run after this module loads and win.
registerStudioCanvasPreview('object', StudioObjectRecordsCanvas);
