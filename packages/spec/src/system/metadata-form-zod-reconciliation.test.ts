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
 * ## "Accepts" is not "is in the shape" (#5280)
 *
 * The original predicate for the form-only direction was `key ∈ shape`. That was
 * the same question as "the author may write this key" right up until
 * `retiredKey()` (`shared/retired-key.ts`) existed — and then it stopped being.
 * A tombstone **deliberately keeps the key in the walked shape** (the retirement
 * kit's liveness ledger says so in as many words: the row stays *because* the
 * key stays), while typing it `z.never().optional()`. So a tombstoned key reads
 * as "the Zod accepts it" to `key ∈ shape`, and this gate stayed green over
 * eight `app` form controls whose every value was **hard-rejected** on save.
 *
 * That is the louder of the two failure modes, and it arrives earlier: an
 * undeclared key is silently stripped (or, on a `.strict()` schema, rejected as
 * unknown), whereas a tombstoned key fails the parse outright with the removal
 * prescription — a 422 the author should never have been able to provoke,
 * because the control should not have been on screen. Both are asserted below,
 * separately, so a failure names which one it is.
 *
 * The detector judges the **schema node** (`z.never()` under the optional
 * wrapper), never the key's name — the zod-side twin of `isRetired()` in
 * `scripts/build-schemas.ts`, which asks the same question of the emitted JSON
 * Schema (`{ "not": {} }`, Zod's rendering of `z.never()`).
 *
 * @see control-flow-form-zod-ledger.test.ts — same pattern for the flow designer
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { METADATA_FORM_REGISTRY } from './metadata-form-registry';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { retiredKey } from '../shared/retired-key';

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

/**
 * Is this property node a **tombstone** — `retiredKey()`, i.e.
 * `z.never().optional().describe(…)`?
 *
 * Judged on the node, not on the key's name: a name list would have to be
 * hand-maintained here, which is the very hand-copied-list defect #3786 exists
 * to abolish. `unwrap` peels the `optional` (and any other wrapper a future
 * tombstone spelling adds), leaving the `never` for the shape test — the same
 * fact `scripts/build-schemas.ts` reads on the JSON-Schema side as `{ not: {} }`.
 */
function isRetiredNode(prop: unknown): boolean {
  const u = unwrap(prop);
  const d = u?.def ?? u?._def;
  return d?.type === 'never';
}

/**
 * Is `key` unwritable at `schema` — declared, but only as a tombstone?
 *
 * A union needs care in the safe direction: one member may tombstone the key
 * while another still declares it live, and an author may legally write the
 * live member's shape. So a key counts as retired only when **every** member
 * that declares it tombstones it.
 */
function isRetiredAt(schema: unknown, key: string): boolean {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    let declaredSomewhere = false;
    for (const option of d.options ?? []) {
      if (!keysOf(option)?.includes(key)) continue;
      declaredSomewhere = true;
      if (!isRetiredAt(option, key)) return false;
    }
    return declaredSomewhere;
  }
  if (d?.type === 'object') {
    const prop = (d.shape ?? u.shape ?? {})[key];
    return prop !== undefined && isRetiredNode(prop);
  }
  return false;
}

/**
 * Keys an author may actually write: declared **and** not a tombstone. This is
 * what `keysOf` was being used as before #5280, and what it never was.
 */
function authorableKeysOf(schema: unknown): string[] | null {
  const keys = keysOf(schema);
  return keys ? keys.filter((k) => !isRetiredAt(schema, k)) : null;
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

  it.each(TYPES)('%s: every field the form offers is a key the author may write', (type) => {
    const root = getMetadataTypeSchema(type);
    const rootKeys = keysOf(root);
    expect(rootKeys, `${type}: root schema is not key-bearing`).toBeTruthy();
    const offered = topLevelFields(METADATA_FORM_REGISTRY[type]);

    // An offered key the schema does not declare is silently stripped on save —
    // the author fills the control and the value never lands.
    expect(
      offered.filter((f) => !rootKeys!.includes(f)),
      `${type}: offered by the form but not declared by the Zod (saved value is dropped)`,
    ).toEqual([]);

    // An offered key the schema TOMBSTONES is worse than dropped: `retiredKey()`
    // is `z.never()`, so filling the control fails the whole save with the
    // removal prescription. The control must not exist (#5280).
    expect(
      offered.filter((f) => isRetiredAt(root, f)),
      `${type}: offered by the form but RETIRED in the Zod (retiredKey tombstone — filling the control hard-fails the save). Delete the form entry and leave a comment naming the retirement`,
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

      expect(
        offered.filter((k) => isRetiredAt(sub, k)),
        `${type}.${path}: offered by the form but RETIRED in the Zod (retiredKey tombstone — filling the control hard-fails the save). Delete the form entry and leave a comment naming the retirement`,
      ).toEqual([]);

      if (isSubset(type, path)) continue;
      const excused = omittedAt(type, path);
      // A tombstoned key needs no ledger entry to excuse its absence — the
      // *only* correct thing to do with it is not offer it. Demanding one back
      // (or a ledger row for it) is this gate's blind spot inverted: before
      // #5280 the sole thing keeping `object.fields.conditionalRequired` off
      // this list was an unrelated `subset` entry, i.e. luck.
      expect(
        subKeys!.filter((k) => !offered.includes(k) && !excused.includes(k) && !isRetiredAt(sub, k)),
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

      const sub = subSchemaOf(root, entry.path);
      const subKeys = keysOf(sub);
      expect(subKeys, `${entry.type}.${entry.path}: sub-schema is not key-bearing any more`).toBeTruthy();

      if (entry.kind === 'omit') {
        // Authorable, not merely present: an `omit` whose key has since been
        // TOMBSTONED is excusing an omission that is now mandatory, and the
        // entry has to go — otherwise the ledger's own "still resolves" check
        // is what keeps a dead excuse alive.
        expect(
          authorableKeysOf(sub),
          `${entry.type}.${entry.path}.${entry.key}: not an authorable key any more — removed, or retired to a tombstone (a retired key is excused automatically). Drop the ledger entry`,
        ).toContain(entry.key);
        expect(
          list!.offered,
          `${entry.type}.${entry.path}.${entry.key}: the form offers it now — drop the ledger entry`,
        ).not.toContain(entry.key);
      } else {
        // A `subset` that covers everything is no longer a subset — counted over
        // AUTHORABLE keys, so a tombstone left in the shape cannot prop up an
        // entry whose real coverage gap has closed.
        expect(
          authorableKeysOf(sub)!.filter((k) => !list!.offered.includes(k)).length,
          `${entry.type}.${entry.path}: the form now covers the whole authorable schema — drop the ledger entry`,
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

// ────────────────────────────────────────────────────────────────────────────
// The tombstone predicate itself (#5280).
//
// Pinned against a SYNTHETIC schema rather than against whichever live schema
// happens to carry a tombstone today: tombstones age out (`retired-key.ts` says
// ~two majors), and a self-test anchored to one would either rot or, worse, go
// quietly vacuous the release its anchor is deleted — leaving a gate that
// filters nothing and still reports green.
// ────────────────────────────────────────────────────────────────────────────

describe('retiredKey tombstones are not authoring surface (#5280)', () => {
  const probe = z.object({
    gone: retiredKey('`Probe.gone` was removed in @objectstack/spec 17.0.0. Delete the key.'),
    live: z.string().optional(),
  });

  it('a tombstone stays in the shape — which is exactly why `key ∈ shape` was the wrong predicate', () => {
    expect(keysOf(probe)).toEqual(['gone', 'live']);
    expect(isRetiredAt(probe, 'gone')).toBe(true);
    expect(isRetiredAt(probe, 'live')).toBe(false);
    expect(authorableKeysOf(probe)).toEqual(['live']);
  });

  it('and the value it rejects fails the parse outright, carrying its prescription', () => {
    // The half of the story the old assertion's wording ("silently stripped on
    // save") could not describe: this one is loud, and earlier.
    const result = probe.safeParse({ gone: 'anything', live: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join('\n')).toContain('was removed in @objectstack/spec');
    expect(probe.safeParse({ live: 'ok' }).success).toBe(true);
  });

  it('detects by schema node, not by key name', () => {
    // A key NAMED like a retirement but declared live is authorable; a key with
    // an unremarkable name that is `z.never()` is not. Nothing here may depend
    // on a hand-maintained list of retired names — that list is the #3786 defect.
    const named = z.object({
      sharing: z.string().optional(),
      ordinary: retiredKey('`Named.ordinary` was removed in @objectstack/spec 17.0.0. Delete the key.'),
    });
    expect(isRetiredAt(named, 'sharing')).toBe(false);
    expect(isRetiredAt(named, 'ordinary')).toBe(true);
  });

  it('a key still declared live by one union member stays authorable', () => {
    // Safe direction: an author may write the live member's shape, so offering
    // the key is not a defect even though another member tombstones it.
    const union = z.union([
      z.object({
        kind: z.literal('a'),
        shared: retiredKey('`A.shared` was removed in @objectstack/spec 17.0.0. Delete the key.'),
      }),
      z.object({ kind: z.literal('b'), shared: z.string().optional() }),
    ]);
    expect(keysOf(union)).toEqual(['kind', 'shared']);
    expect(isRetiredAt(union, 'shared')).toBe(false);
  });
});
