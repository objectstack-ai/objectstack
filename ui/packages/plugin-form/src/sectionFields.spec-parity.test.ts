/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `normalizeSectionField` ↔ `@objectstack/spec` FormFieldSchema coverage gate
 * (#3090, objectstack#4115).
 *
 * The normalizer is THE chokepoint between the two form-field vocabularies:
 * the spec's authored shape (`field` = object-field reference, presentation
 * deltas only) and the runtime shape (`name` = data path, self-contained
 * widget config). It cannot be a derivation — every key is a *translation*
 * with a destination of its own — so the gate is behavioral instead:
 *
 *   - TABLE below holds one row per spec key: a sample authored value and an
 *     assertion that the normalized output reflects it at its documented
 *     destination. Deleting a mapping line in `sectionFields.ts` fails the
 *     row — the rows are mutation-tested coverage, not a mirror list.
 *   - The key sets are then compared BOTH ways against the spec's own
 *     enumeration: a key the spec adds fails as UNMAPPED (decide: map it or
 *     exempt it with a reason); a key the spec retires fails as STALE.
 *
 * Until this gate existed the drift was real: the ADR-0089 canonical
 * `visibleWhen` spelling, `dependsOn`, `keyField` and `disclosure` were all
 * silently dropped while the DEPRECATED `visibleOn` spelling worked.
 */

import { describe, it, expect } from 'vitest';
// The drift guard is the ONE legitimate importer of the spec's FormFieldSchema
// in this repo: it exists to enumerate the spec's key set. Everywhere else the
// import is a layer violation — see the no-restricted-imports entry in
// eslint.config.js (#3090).
// eslint-disable-next-line no-restricted-imports
import { FormFieldSchema as SpecFormFieldSchema } from '@objectstack/spec/ui';
// Not restricted, and not a layer violation: `ComponentPropsMap` is read ONLY
// as the marker of which spec line is installed (see the GA-pending block
// below), never for a form field's shape.
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { mapFieldTypeToFormType } from '@object-ui/fields';
import { normalizeSectionField } from './sectionFields';

const objectSchema = {
  name: 'crm_account',
  fields: {
    industry: {
      type: 'select',
      label: 'Industry',
      options: [{ label: 'Tech', value: 'tech' }],
    },
  },
};

const ctx = {
  objectSchema,
  objectName: 'crm_account',
  fieldLabel: (_obj: string, _name: string, fallback: string) => fallback || _name,
};

/** Normalize a spec field def against a schema that does NOT define `ghost`,
 * so every override is observable verbatim (no object-metadata interference). */
const norm = (def: Record<string, unknown>) =>
  normalizeSectionField({ field: 'ghost', ...def }, ctx) as any;

/**
 * One row per spec FormFieldSchema key: sample authored value → where the
 * runtime FormField must carry it. Non-obvious destinations are the point:
 * `helpText`→`description`, `readonly`→`disabled`, and `visibleWhen`→the
 * view-level `visibleOn` slot (the runtime `visibleWhen` slot belongs to the
 * object-level rule and must not be clobbered).
 *
 * A RETIRED spec key keeps a row too, asserting the opposite: that it reaches
 * no destination. The spec's own `visibleOn` is one (objectui#12654): spec 18
 * keeps it in the shape as a `retiredKey` tombstone, and the installed 18 line
 * before that still declares it as a deprecated alias, so on both shapes it is
 * a key the table must cover — by proving the normalizer drops it.
 */
const TABLE: Record<string, (f: (def: Record<string, unknown>) => any) => void> = {
  field: () => {
    const out = normalizeSectionField({ field: 'industry' }, ctx) as any;
    expect(out.name).toBe('industry'); // identity key translated to the data path
    expect(out.type).toBe(mapFieldTypeToFormType('select')); // object schema merged in
  },
  type: (f) => expect(f({ type: 'text' }).type).toBe(mapFieldTypeToFormType('text')),
  options: (f) =>
    expect(f({ options: [{ label: 'A', value: 'a' }] }).options).toEqual([
      { label: 'A', value: 'a' },
    ]),
  reference: (f) => {
    const out = f({ reference: 'accounts' });
    expect(out.reference).toBe('accounts');
    // One spelling, no second stamped (objectui#11070 round 4).
    expect(out.reference_to).toBeUndefined();
  },
  maxLength: (f) => expect(f({ maxLength: 10 }).maxLength).toBe(10),
  minLength: (f) => expect(f({ minLength: 2 }).minLength).toBe(2),
  min: (f) => expect(f({ min: 1 }).min).toBe(1),
  max: (f) => expect(f({ max: 9 }).max).toBe(9),
  precision: (f) => expect(f({ precision: 10 }).precision).toBe(10),
  scale: (f) => expect(f({ scale: 2 }).scale).toBe(2),
  multiple: (f) => expect(f({ multiple: true }).multiple).toBe(true),
  label: (f) => expect(f({ label: 'Custom' }).label).toBe('Custom'),
  placeholder: (f) => expect(f({ placeholder: 'Type…' }).placeholder).toBe('Type…'),
  helpText: (f) => expect(f({ helpText: 'Hint' }).description).toBe('Hint'),
  readonly: (f) => expect(f({ readonly: true }).disabled).toBe(true),
  immutable: (f) => expect(f({ immutable: true }).immutable).toBe(true),
  required: (f) => expect(f({ required: true }).required).toBe(true),
  hidden: (f) => expect(f({ hidden: true }).hidden).toBe(true),
  colSpan: (f) => expect(f({ colSpan: 2 }).colSpan).toBe(2),
  span: (f) => expect(f({ span: 'full' }).span).toBe('full'),
  widget: (f) => expect(f({ widget: 'rating' }).widget).toBe('rating'),
  language: (f) => expect(f({ language: 'sql' }).language).toBe('sql'),
  fields: (f) =>
    expect(f({ fields: [{ field: 'inner' }] }).fields).toEqual([{ field: 'inner' }]),
  keyField: (f) =>
    expect(f({ keyField: { field: 'name' } }).keyField).toEqual({ field: 'name' }),
  dependsOn: (f) => expect(f({ dependsOn: 'country' }).dependsOn).toBe('country'),
  visibleWhen: (f) =>
    expect(f({ visibleWhen: 'record.a == 1' }).visibleOn).toBe('record.a == 1'),
  visibleOn: (f) => {
    // Retired (objectui#12654): the spec spelling is not carried into the
    // runtime view-level slot of the same name. The control is the row above.
    expect(f({ visibleOn: 'record.b == 2' }).visibleOn).toBeUndefined();
  },
  disclosure: (f) => expect(f({ disclosure: 'popover' }).disclosure).toBe('popover'),
};

/** Spec keys the normalizer deliberately does not carry, each with a reason.
 * Add entries here (never silently) when the spec grows a key that genuinely
 * has no runtime destination — and state WHY there is none, since "no row yet"
 * and "no destination" are the two things this list must keep apart. */
const EXEMPT: Record<string, string> = {
  publicPicker:
    "A server-side authorization opt-in, not a presentation delta: it gates objectstack's public-lookup route (`GET /forms/:slug/lookup/:field` answers only for a field whose form declaration carries it, `403 LOOKUP_NOT_PUBLIC` otherwise, objectstack#7467), and the public-form resolve route strips undeclared lookup fields from the rendered sections. `normalizeSectionField` builds the runtime widget config for an in-app authenticated form and has NO destination for it — zero read points repo-wide (`grep -rn publicPicker packages/ apps/` is empty) — so mapping it anywhere would invent a client-side meaning for a capability only the server enforces. Reasoned exemption ruled on objectui#4648 (delegated ruling item 5, 2026-08-15); it becomes an implementation card if objectui ever renders anonymous public forms.",
};

/**
 * EXEMPT keys the installed spec is allowed not to declare yet.
 *
 * `publicPicker` arrives in `@objectstack/spec` 17.0.0 GA; this repo is pinned
 * to `^17.0.0-rc.6`, which has no such key, so on the current pin the entry
 * describes nothing and both checks below would read it as stale. Pinned as a
 * SET, not a blanket "skip anything the spec lacks", so exactly one entry may
 * be dormant and a typo in any other still fails.
 */
const GA_PENDING_EXEMPT = ['publicPicker'];

/** The authoring shape of a spec object schema, through a transform pipe if there is one. */
function shapeOf(schema: unknown): Record<string, unknown> {
  let node = schema as { shape?: Record<string, unknown>; _zod: { def: { type: string; in?: unknown } } };
  for (let depth = 0; depth < 4 && !node.shape; depth++) {
    if (node._zod.def.type !== 'pipe') break;
    node = node._zod.def.in as typeof node;
  }
  if (!node.shape) throw new Error('could not reach the shape of the installed spec FormFieldSchema');
  return node.shape;
}

describe('normalizeSectionField covers the spec FormFieldSchema key set', () => {
  // Through the 18 pre-releases `.strict().transform()` wrapped the object in
  // a ZodPipe whose `.in` carried the authoring shape; spec 18 drops the
  // transform and the schema IS the closed object (objectstack#23543 F4). Walk
  // to the shape on either form, so the next spec bump does not turn this gate
  // red for a reason that is not a key change (objectui#12654).
  const specKeys = Object.keys(shapeOf(SpecFormFieldSchema)).sort();

  /** A GA-pending exemption the installed spec does not declare yet. */
  const isDormant = (key: string) => GA_PENDING_EXEMPT.includes(key) && !specKeys.includes(key);

  it('has a behavioral row (or an exemption with a reason) for every spec key', () => {
    const covered = [
      ...Object.keys(TABLE),
      ...Object.keys(EXEMPT).filter((key) => !isDormant(key)),
    ].sort();
    expect(covered).toEqual(specKeys);
  });

  it('has no stale rows for keys the spec has retired', () => {
    for (const key of [...Object.keys(TABLE), ...Object.keys(EXEMPT)]) {
      if (isDormant(key)) continue; // pre-GA pin: the key is not there to be stale
      expect(specKeys, `'${key}' is no longer a spec FormField key`).toContain(key);
    }
  });

  it('every GA-pending exemption is a real entry, and arms with the installed spec', () => {
    // Non-vacuity for the pending set: an entry named here but absent from
    // EXEMPT licenses nothing while reading as a decision, and a key that stays
    // dormant on a GA tree is an exemption covering nothing at all.
    expect(GA_PENDING_EXEMPT.length).toBeGreaterThan(0);
    const specCarriesGaElements = 'object-form' in ComponentPropsMap;
    for (const key of GA_PENDING_EXEMPT) {
      expect(Object.keys(EXEMPT), `'${key}' is pinned as GA-pending but has no entry`).toContain(key);
      // The spec ships no version constant, so GA is read off the element set
      // it carries — `object-form` is the forms-side member of the four blocks
      // 17.0.0 added (objectui#4648).
      expect(isDormant(key), `'${key}' dormancy disagrees with the installed spec`).toBe(
        !specCarriesGaElements,
      );
    }
  });

  it('every exemption states a reason and cites a tracking issue', () => {
    // Same discipline as the repo-wide gate in apps/console: an exemption
    // without an owner is a permanent allowlist entry with extra steps.
    const unjustified = Object.entries(EXEMPT)
      .filter(([, reason]) => !/#\d+/.test(reason))
      .map(([key]) => key);
    expect(unjustified).toEqual([]);
  });

  for (const [key, assertRow] of Object.entries(TABLE)) {
    it(`carries spec '${key}' to its runtime destination`, () => {
      assertRow(norm);
    });
  }
});
