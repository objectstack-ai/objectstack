// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Metadata form ↔ Zod reconciliation** (#3786).
 *
 * Every entry in {@link METADATA_FORM_REGISTRY} is a hand-written `defineForm`
 * layout that names keys of a Zod schema it never imports. That is the
 * hand-copied-list shape #3786 was filed about: two descriptions of one key set,
 * a comment asking the next author to keep them in step, and nothing that fails
 * when they don't. Four of the seventeen forms had already drifted when this
 * file was written, each silently:
 *
 * | form | drift | what an author saw |
 * |---|---|---|
 * | `object` | `capabilities` — no such key (`enable`) | the whole Capabilities section saved nothing |
 * | `object` | 16 keys `FieldSchema` never declared | PII / Encrypted / Indexed / … toggles saved nothing |
 * | `report` | `aria`, `performance` pruned by #3496 | two Advanced fields saved nothing |
 * | `hook`, `action` | `body.memoryMb` absent | the L2 memory cap was unauthorable |
 * | `page` | `interfaceConfig.sort` absent | a page's default sort was unauthorable |
 *
 * All of it failed the same way: **no error**. `FieldSchema` / `ObjectSchema` are
 * deliberately not `.strict()`, so a key the schema does not declare parses clean
 * and is stripped on the way to storage — the ADR-0104 failure class the
 * `field.zod.ts` prune tombstone already names in prose.
 *
 * ## The two directions are not symmetric
 *
 * - **form-only** (the form offers a key the Zod does not accept) is *always* a
 *   defect. There is no design under which an author should be shown a control
 *   whose value is discarded. Not ledgerable.
 * - **zod-only** (the Zod accepts a key the form does not offer) is sometimes
 *   deliberate: a deprecated key kept out of new authoring, or a curated
 *   quick-add subset that defers to a fuller editor. Ledgerable — with a reason,
 *   checked below for non-vacuity and for still resolving on both sides, the
 *   #4045 / #4040 ledger discipline.
 *
 * @see control-flow-form-zod-ledger.test.ts — same pattern for the flow designer
 */

import { describe, it, expect } from 'vitest';

import { METADATA_FORM_REGISTRY } from './metadata-form-registry';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

// ────────────────────────────────────────────────────────────────────────────
// Ledger — deliberate zod-only omissions. `omit` names one key; `subset`
// declares a whole nested list as a curated subset (coverage unenforced there,
// the form-only direction still is).
// ────────────────────────────────────────────────────────────────────────────

type OmitEntry = { kind: 'omit'; type: string; path: string; key: string; why: string };
type SubsetEntry = { kind: 'subset'; type: string; path: string; why: string };

const LEDGER: ReadonlyArray<OmitEntry | SubsetEntry> = [
  {
    kind: 'omit',
    type: 'page',
    path: 'interfaceConfig',
    key: 'sourceView',
    why: '@deprecated legacy named-view inheritance, honored at runtime as a fallback but deliberately not offered to new authors — a page defines columns/sort/filterBy directly (ADR-0047 revised)',
  },
  {
    kind: 'omit',
    type: 'object',
    path: 'enable',
    key: 'apiMethods',
    why: 'the Capabilities block is a toggle grid; apiMethods is a method whitelist (array of ApiMethod) that needs its own control, and is authored on the object body rather than as a switch',
  },
  {
    kind: 'subset',
    type: 'object',
    path: 'fields',
    why: "the object editor's inline column grid is a QUICK-ADD surface covering the common authoring keys; the full per-field editor is `field.form.ts` (registered as the `field` metadata type), which is where the long tail of FieldSchema is authored",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Zod introspection — reads `.def` directly so the test needs no `zod` import
// beyond what the schemas already are, and tolerates the `lazySchema` proxy.
// ────────────────────────────────────────────────────────────────────────────

/** Peel wrapper nodes until an object/union/record-value node is reached. */
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
    case 'pipe':
      return unwrap(d.in, depth + 1);
    default:
      return s;
  }
}

/**
 * Keys an object node accepts, or `null` when the node is not key-bearing.
 * A union contributes the union of its members' keys — an author may legally
 * write any member's key, so offering one is not a form-only defect.
 */
function keysOf(schema: unknown): string[] | null {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'object') return Object.keys(d.shape ?? u.shape ?? {}).sort();
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    const all = new Set<string>();
    let keyBearing = false;
    for (const option of d.options ?? []) {
      const k = keysOf(option);
      if (k) {
        keyBearing = true;
        for (const key of k) all.add(key);
      }
    }
    return keyBearing ? Array.from(all).sort() : null;
  }
  return null;
}

/** The sub-schema stored under `key`, looking through union members. */
function subSchemaOf(schema: unknown, key: string): unknown {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'object') return (d.shape ?? u.shape ?? {})[key];
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    for (const option of d.options ?? []) {
      const found = subSchemaOf(option, key);
      if (found) return found;
    }
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Form introspection
// ────────────────────────────────────────────────────────────────────────────

type FormEntry = { field?: string; fields?: FormEntry[]; keyField?: { field?: string } };

/** Top-level `field:` names a form offers, across every section. */
function topLevelFields(form: any): string[] {
  const names: string[] = [];
  for (const section of form.sections ?? []) {
    for (const entry of (section.fields ?? []) as FormEntry[]) {
      if (entry?.field) names.push(entry.field);
    }
  }
  return names.sort();
}

/**
 * Every nested list a form spells out by hand — `{ field, fields: [...] }` under
 * a composite / repeater / record entry. These are the hand-copied lists; an
 * entry with no `fields` is derived from the schema by the renderer and cannot
 * drift.
 */
function nestedLists(form: any): Array<{ path: string; offered: string[] }> {
  const out: Array<{ path: string; offered: string[] }> = [];
  for (const section of form.sections ?? []) {
    for (const entry of (section.fields ?? []) as FormEntry[]) {
      if (!entry?.field || !Array.isArray(entry.fields) || entry.fields.length === 0) continue;
      const offered = entry.fields.map((f) => f?.field).filter((f): f is string => !!f);
      // A record editor authors its map key through `keyField`, so that name is
      // offered even though it is not in the `fields` array.
      if (entry.keyField?.field) offered.push(entry.keyField.field);
      out.push({ path: entry.field, offered: offered.sort() });
    }
  }
  return out;
}

const TYPES = Object.keys(METADATA_FORM_REGISTRY);
const ledgerFor = (type: string, path: string) =>
  LEDGER.filter((e) => e.type === type && e.path === path);
const isSubset = (type: string, path: string) =>
  ledgerFor(type, path).some((e) => e.kind === 'subset');
const omittedAt = (type: string, path: string) =>
  ledgerFor(type, path).flatMap((e) => (e.kind === 'omit' ? [e.key] : []));

describe('metadata form ↔ Zod reconciliation (#3786)', () => {
  it('the registry is non-empty and every form resolves a schema', () => {
    // Without this the per-type assertions below would pass over an empty set —
    // the failure mode a reconciliation test must not have.
    expect(TYPES.length).toBeGreaterThan(10);
    for (const type of TYPES) {
      expect(getMetadataTypeSchema(type), `no Zod schema registered for '${type}'`).toBeDefined();
    }
  });

  it.each(TYPES)('%s: every field the form offers is a key the Zod accepts', (type) => {
    const root = getMetadataTypeSchema(type);
    const rootKeys = keysOf(root);
    expect(rootKeys, `${type}: root schema is not key-bearing`).toBeTruthy();

    // An offered key the schema does not declare is silently stripped on save —
    // the author fills the control and the value never lands.
    expect(
      topLevelFields(METADATA_FORM_REGISTRY[type]).filter((f) => !rootKeys!.includes(f)),
      `${type}: offered by the form but not declared by the Zod (saved value is dropped)`,
    ).toEqual([]);
  });

  it.each(TYPES)('%s: every hand-written nested list matches its sub-schema', (type) => {
    const root = getMetadataTypeSchema(type);

    for (const { path, offered } of nestedLists(METADATA_FORM_REGISTRY[type])) {
      const sub = subSchemaOf(root, path);
      const subKeys = keysOf(sub);
      // A non-key-bearing sub-schema (a plain array of scalars, say) has nothing
      // to reconcile against — but a hand-written list under it is then
      // unanchored, so say so rather than skipping silently.
      expect(subKeys, `${type}.${path}: hand-written sub-list over a non-key-bearing schema`).toBeTruthy();

      expect(
        offered.filter((k) => !subKeys!.includes(k)),
        `${type}.${path}: offered by the form but not declared by the Zod (saved value is dropped)`,
      ).toEqual([]);

      if (isSubset(type, path)) continue;
      const excused = omittedAt(type, path);
      expect(
        subKeys!.filter((k) => !offered.includes(k) && !excused.includes(k)),
        `${type}.${path}: accepted by the Zod but unauthorable in the form — offer it, or add a ledger entry`,
      ).toEqual([]);
    }
  });

  it('every ledger entry still resolves on both sides', () => {
    // Stops the ledger rotting into references to keys that were renamed or
    // removed, and stops an `omit` outliving the omission it excuses.
    for (const entry of LEDGER) {
      const root = getMetadataTypeSchema(entry.type);
      expect(root, `ledger references unknown metadata type '${entry.type}'`).toBeDefined();

      const lists = nestedLists(METADATA_FORM_REGISTRY[entry.type]);
      const list = lists.find((l) => l.path === entry.path);
      expect(list, `${entry.type}.${entry.path}: no hand-written list at this path any more`).toBeDefined();

      const subKeys = keysOf(subSchemaOf(root, entry.path));
      expect(subKeys, `${entry.type}.${entry.path}: sub-schema is not key-bearing any more`).toBeTruthy();

      if (entry.kind === 'omit') {
        expect(subKeys, `${entry.type}.${entry.path}.${entry.key}: not in the Zod any more`).toContain(entry.key);
        expect(
          list!.offered,
          `${entry.type}.${entry.path}.${entry.key}: the form offers it now — drop the ledger entry`,
        ).not.toContain(entry.key);
      } else {
        // A `subset` that covers everything is no longer a subset.
        expect(
          subKeys!.filter((k) => !list!.offered.includes(k)).length,
          `${entry.type}.${entry.path}: the form now covers the whole schema — drop the ledger entry`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('the ledger is not vacuous and every entry carries a reason', () => {
    expect(LEDGER.length).toBeGreaterThan(0);
    for (const entry of LEDGER) {
      const label = `${entry.type}.${entry.path}${entry.kind === 'omit' ? `.${entry.key}` : ''}`;
      expect(entry.why.length, `${label} needs a reason a reader can act on`).toBeGreaterThan(20);
    }
  });
});
