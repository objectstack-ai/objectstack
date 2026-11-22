/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette's create rows (objectstack#36286): which of the app's objects
 * the member may create a record of, and the address each create opens.
 *
 * An object is offered exactly where the object list offers its New: the
 * `listNew` verdict of `resolveAffordance` (the spec's CRUD bucket and
 * `userActions`, intersected with the server's effective API operations and
 * the caller's create grant), then the create action's toolbar-scope
 * predicates, bound with no record as the list's toolbar binds them:
 * `visibleWhen` fails closed, `disabledWhen` fails soft. A greyed New is not
 * offered here: the palette draws no disabled row.
 *
 * A create opens the object's create page, `/apps/APP/OBJECT/new`, the route
 * the bare data surface's New and a related list's New open. A "create as"
 * row carries the typed words as that page's query-string prefill of the
 * object's title field (`resolveNameField`, the ADR-0079 ladder), and is
 * offered only where that field is a plain text field the member may write
 * on create (`createFormFields`), so the words always land in the form.
 */

import {
  evalRowPredicate,
  resolveAffordance,
  resolveFieldAffordance,
  resolveNameField,
  type AffordanceGrantPrincipal,
  type AffordanceSource,
  type FieldAffordancePrincipal,
  type RowCrudPredicates,
} from '@object-ui/core';

/** The object definition keys the create rows read. */
export interface PaletteCreateObjectDef {
  name: string;
  label?: unknown;
  icon?: unknown;
  color?: unknown;
  fields?: Record<string, { type?: unknown; readonly?: unknown } | undefined> | unknown;
  [key: string]: unknown;
}

/** What the create rows ask of the permission provider: `usePermissions()`. */
export type PaletteCreatePerms = AffordanceGrantPrincipal & FieldAffordancePrincipal;

/** One object the member may create a record of. */
export interface PaletteCreateTarget {
  objectName: string;
  def: PaletteCreateObjectDef;
  /** The field a "create as" row fills with the typed words; absent ⇒ no such row. */
  prefillField?: string;
}

/** At most this many "create as" rows are drawn, the route's own object first. */
export const CREATE_AS_MAX = 3;

/** Field types that hold the typed words as they are. */
const PREFILLABLE_TYPES = new Set(['text', 'textarea']);

/**
 * The create action's toolbar-scope predicate, bound with no record, the way
 * `useRowPredicate(pred, null, …)` binds it for the list's New.
 */
function toolbarPredicate(pred: unknown, fallback: boolean, scope: Record<string, unknown>, label: string): boolean {
  if (typeof pred === 'boolean') return pred;
  if (pred == null || pred === '') return fallback;
  return evalRowPredicate(pred as Parameters<typeof evalRowPredicate>[0], null, {
    fallback,
    scope,
    warnOnError: true,
    label,
  });
}

/** May the member create a record of `def` from a toolbar with no record in scope? */
export function paletteMayCreate(
  def: PaletteCreateObjectDef,
  perms: PaletteCreatePerms | undefined,
  scope: Record<string, unknown>,
): boolean {
  const verdict = resolveAffordance('listNew', {
    objectSchema: def as AffordanceSource['objectSchema'],
    objectName: def.name,
    perms,
  });
  if (!verdict.allowed) return false;
  const predicates: RowCrudPredicates | undefined = verdict.predicates;
  if (!toolbarPredicate(predicates?.visibleWhen ?? true, false, scope, 'builtin:create:visibleWhen')) return false;
  const disabled =
    predicates?.disabledWhen != null &&
    toolbarPredicate(predicates.disabledWhen, false, scope, 'builtin:create:disabledWhen');
  return !disabled;
}

/** The title field a create may be seeded with, or `undefined`. */
export function palettePrefillField(def: PaletteCreateObjectDef, perms: PaletteCreatePerms | undefined): string | undefined {
  const name = resolveNameField(def);
  if (!name) return undefined;
  const fields = def.fields && typeof def.fields === 'object' && !Array.isArray(def.fields)
    ? (def.fields as Record<string, { type?: unknown; readonly?: unknown } | undefined>)
    : undefined;
  const field = fields?.[name];
  if (!field || typeof field.type !== 'string' || !PREFILLABLE_TYPES.has(field.type)) return undefined;
  if (field.readonly === true) return undefined;
  if (!resolveFieldAffordance('createFormFields', perms, def.name, name)) return undefined;
  return name;
}

/**
 * The objects of `objectNames` (the app's navigation objects, in its order)
 * the member may create a record of, `currentObjectName` first when it is one
 * of them.
 */
export function paletteCreateTargets(
  objectNames: readonly string[],
  objectsByName: ReadonlyMap<string, PaletteCreateObjectDef>,
  perms: PaletteCreatePerms | undefined,
  scope: Record<string, unknown>,
  currentObjectName?: string,
): PaletteCreateTarget[] {
  const seen = new Set<string>();
  const targets: PaletteCreateTarget[] = [];
  for (const name of objectNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const def = objectsByName.get(name);
    if (!def || !paletteMayCreate(def, perms, scope)) continue;
    targets.push({ objectName: name, def, prefillField: palettePrefillField(def, perms) });
  }
  const current = targets.findIndex((target) => target.objectName === currentObjectName);
  if (current > 0) targets.unshift(...targets.splice(current, 1));
  return targets;
}

/** The address a create opens: the object's create page, seeded when `prefill` names a field. */
export function paletteCreateHref(
  baseUrl: string,
  objectName: string,
  prefill?: { field: string; value: string },
): string {
  const page = `${baseUrl}/${encodeURIComponent(objectName)}/new`;
  if (!prefill) return page;
  return `${page}?${new URLSearchParams([[prefill.field, prefill.value]]).toString()}`;
}

/**
 * The object of the page the palette was opened on, read off its address
 * (`/apps/APP/OBJECT…`), when it is one of `objectNames`.
 */
export function routeObjectName(pathname: string, objectNames: readonly string[]): string | undefined {
  const segment = /^\/apps\/[^/]+\/([^/?#]+)/.exec(pathname)?.[1];
  if (!segment) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return objectNames.includes(name) ? name : undefined;
}
