// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object a metadata form's field pickers offer the fields of, read off the
 * form's own declaration (objectstack#37309).
 *
 * `field-ref`, `field-multi`, `filter-builder` and `action-multi` draw the
 * BOUND object's catalog (`WidgetContext.objectFields` / `objectActions`); none
 * of them reads its row's `dependsOn`. The editor binds the catalog to one
 * object for the whole form, and it found that object on a fixed list of draft
 * paths (`interfaceConfig.source`, `data.object`, `object`, `objectName`). A
 * form whose object lives anywhere else — a knowledge source's
 * `source.object` — had pickers that offered nothing, whatever its rows'
 * `dependsOn` said.
 *
 * This reads the path the form declares instead: the first catalog row's
 * `dependsOn`, prefixed by the composites it sits in, so a row inside the
 * `source` composite that names its sibling `object` binds `source.object`
 * (the `page.metadata-form.ts` spelling: `columns` inside `interfaceConfig`
 * names `source`). A dotted `dependsOn` at the top level (`data.object`, the
 * view form's) is a path from the root as written. A repeater's or a record's
 * rows are not walked: their `dependsOn` names a key of each ROW, not one
 * object for the form.
 */

/** The widgets that draw the form's one bound object's catalog. */
const BOUND_CATALOG_WIDGETS: ReadonlySet<string> = new Set(['field-ref', 'field-multi', 'filter-builder', 'action-multi']);

interface FormRowLike {
  field?: unknown;
  widget?: unknown;
  type?: unknown;
  dependsOn?: unknown;
  fields?: unknown;
}

function rowsOf(value: unknown): FormRowLike[] {
  return Array.isArray(value)
    ? value.filter((r): r is FormRowLike => !!r && typeof r === 'object')
    : [];
}

function walk(rows: FormRowLike[], prefix: string): string | undefined {
  for (const row of rows) {
    const dep = Array.isArray(row.dependsOn) ? row.dependsOn[0] : row.dependsOn;
    if (typeof row.widget === 'string' && BOUND_CATALOG_WIDGETS.has(row.widget) && typeof dep === 'string' && dep) {
      return `${prefix}${dep}`;
    }
    if (row.type === 'composite' && typeof row.field === 'string') {
      const nested = walk(rowsOf(row.fields), `${prefix}${row.field}.`);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** The draft path of the object the form's field pickers are bound to, as the form declares it; `undefined` when no catalog row names one. */
export function declaredBoundObjectPath(form: unknown): string | undefined {
  const sections = (form as { sections?: unknown } | null | undefined)?.sections;
  for (const section of rowsOf(sections)) {
    const found = walk(rowsOf(section.fields), '');
    if (found) return found;
  }
  return undefined;
}

/** The non-empty string at a dotted path of the draft, else `undefined`. */
export function objectNameAt(draft: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  let node: unknown = draft;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'string' && node ? node : undefined;
}
