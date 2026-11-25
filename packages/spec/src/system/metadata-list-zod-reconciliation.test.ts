// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Metadata list ↔ Zod reconciliation.**
 *
 * Every column in {@link METADATA_LIST_REGISTRY} names a key of a Zod schema
 * the registry never imports — the same hand-copied-list shape
 * `metadata-form-zod-reconciliation.test.ts` closes for forms. A column naming
 * a key the schema does not declare renders an empty cell on every row and
 * fails nowhere else, so this file is where it fails:
 *
 * - every registered type has a schema, and its list binds to that type;
 * - every column path resolves, segment by segment, to a declared key (unions
 *   looked through, the same walk the form gate uses) that is not a
 *   `retiredKey()` tombstone and not the provenance/lock overlay;
 * - every header equals the English source of the slot it is translated
 *   through, `metadataForms.<type>.fields.<field>.label`: the form field's own
 *   label when the type's form declares that path, else the humanized path
 *   (what `os i18n extract` emits for it). Two English sources for one slot
 *   would leave one of them untranslated.
 */

import { describe, it, expect } from 'vitest';

import { METADATA_LIST_REGISTRY } from './metadata-list-registry';
import { METADATA_FORM_REGISTRY } from './metadata-form-registry';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { defineList } from '../ui/view.zod';

/** Peel wrapper nodes until an object/union node is reached (the form gate's walk). */
function unwrap(schema: unknown, depth = 0): any {
  const s = schema as any;
  if (!s || depth > 25) return s;
  const d = s.def ?? s._def;
  if (!d) return s;
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return unwrap(d.innerType, depth + 1);
    case 'array':
      return unwrap(d.element, depth + 1);
    case 'record':
      return unwrap(d.valueType, depth + 1);
    case 'lazy':
      return unwrap(d.getter(), depth + 1);
    case 'pipe': {
      const inner = unwrap(d.in, depth + 1);
      const innerType = (inner?.def ?? inner?._def)?.type;
      return innerType === 'transform' ? unwrap(d.out, depth + 1) : inner;
    }
    default:
      return s;
  }
}

/** The property node under `key`, looking through union members; `undefined` when undeclared. */
function propertyOf(schema: unknown, key: string): unknown {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'object') return (d.shape ?? u.shape ?? {})[key];
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    for (const option of d.options ?? []) {
      const found = propertyOf(option, key);
      if (found !== undefined && !isRetiredNode(found)) return found;
    }
    for (const option of d.options ?? []) {
      const found = propertyOf(option, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** A `retiredKey()` tombstone: `z.never()` under its optional wrapper. */
function isRetiredNode(prop: unknown): boolean {
  const u = unwrap(prop);
  return (u?.def ?? u?._def)?.type === 'never';
}

/** Why `path` does not resolve to a writable key of `root`, or `null` when it does. */
function pathDefect(root: unknown, path: string): string | null {
  let node: unknown = root;
  for (const segment of path.split('.')) {
    if (segment.startsWith('_')) return `\`${segment}\` is the provenance/lock overlay, not the type's own key`;
    const next = propertyOf(node, segment);
    if (next === undefined) return `\`${segment}\` is not declared`;
    if (isRetiredNode(next)) return `\`${segment}\` is retired`;
    node = next;
  }
  return null;
}

/** The extractor's fallback label for a path with no declared label (`humanizeFieldPath`, `@objectstack/lint`). */
function humanizeFieldPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `path → English label` for every field the type's form declares, at every depth. */
function formFieldLabels(type: string): Map<string, string> {
  const out = new Map<string, string>();
  const form = METADATA_FORM_REGISTRY[type] as any;
  const walk = (fields: any[] | undefined, parent: string) => {
    for (const f of fields ?? []) {
      if (!f || typeof f !== 'object') continue;
      const path = typeof f.field === 'string' ? (parent ? `${parent}.${f.field}` : f.field) : parent;
      if (path && typeof f.field === 'string') {
        out.set(path, typeof f.label === 'string' ? f.label : humanizeFieldPath(path));
      }
      walk(f.fields, path);
    }
  };
  for (const section of [...(form?.sections ?? []), ...(form?.groups ?? [])]) walk(section?.fields, '');
  return out;
}

const TYPES = Object.keys(METADATA_LIST_REGISTRY);

describe('METADATA_LIST_REGISTRY ↔ the type schemas', () => {
  it('declares a list for the first-batch types and the nine types the console used to declare', () => {
    expect(TYPES.sort()).toEqual([
      'action', 'agent', 'api', 'assignment_rule', 'book', 'dashboard', 'dataset', 'doc',
      'email_template', 'field', 'flow', 'hook', 'job', 'mapping', 'object', 'page',
      'permission', 'picklist', 'position', 'queue', 'report', 'seed', 'sharing_rule',
      'skill', 'tool', 'translation', 'view',
    ]);
  });

  it.each(TYPES)('%s: binds to its own type, which has a schema', (type) => {
    const list = METADATA_LIST_REGISTRY[type] as any;
    expect(list.data).toEqual({ provider: 'schema', schemaId: type });
    expect(getMetadataTypeSchema(type)).toBeDefined();
  });

  it.each(TYPES)('%s: every column names a declared, writable key of the schema', (type) => {
    const root = getMetadataTypeSchema(type);
    const defects = METADATA_LIST_REGISTRY[type].columns
      .map((c) => [c.field, pathDefect(root, c.field)] as const)
      .filter(([, defect]) => defect !== null)
      .map(([field, defect]) => `${type}.${field}: ${defect}`);
    expect(defects).toEqual([]);
  });

  it.each(TYPES)('%s: no column is declared twice', (type) => {
    const fields = METADATA_LIST_REGISTRY[type].columns.map((c) => c.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it.each(TYPES)('%s: every header is the English source of its translation slot', (type) => {
    const formLabels = formFieldLabels(type);
    const mismatches = METADATA_LIST_REGISTRY[type].columns
      .map((c) => ({ field: c.field, label: c.label, source: formLabels.get(c.field) ?? humanizeFieldPath(c.field) }))
      .filter((c) => c.label !== c.source)
      .map((c) => `${type}.${c.field}: header ${JSON.stringify(c.label)}, slot source ${JSON.stringify(c.source)}`);
    expect(mismatches).toEqual([]);
  });
});

describe('the gate can fail', () => {
  it('names an undeclared key, a retired key and an overlay key', () => {
    const hook = getMetadataTypeSchema('hook');
    expect(pathDefect(hook, 'objectName')).toBe('`objectName` is not declared');
    expect(pathDefect(hook, '_packageId')).toMatch(/overlay/);
    expect(pathDefect(getMetadataTypeSchema('email_template'), 'category')).toBe('`category` is retired');
    expect(pathDefect(getMetadataTypeSchema('api'), 'objectParams.object')).toBeNull();
    expect(pathDefect(getMetadataTypeSchema('api'), 'objectParams.target')).toBe('`target` is not declared');
  });

  it('defineList refuses a column with a renderer outside the closed vocabulary, or no columns', () => {
    expect(() => defineList({ schemaId: 'hook', columns: [{ field: 'name', type: 'currency' as never }] })).toThrow();
    expect(() => defineList({ schemaId: 'hook', columns: [] })).toThrow();
    expect(() => defineList({ schemaId: 'hook', columns: [{ field: 'name', width: 120 } as never] })).toThrow();
  });
});
