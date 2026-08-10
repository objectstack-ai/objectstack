// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6629] `COMPONENT_FIELD_SPECS` ↔ `ComponentPropsMap` liveness.
 *
 * `COMPONENT_FIELD_SPECS` is the one hand-written, centralized declaration of
 * "which component props carry FIELD NAMES", and until this test nothing
 * reconciled it against the spec: a spec-side retirement disposes of the schema
 * (tombstone, ADR-0087 conversion, generated artifacts) but no gate reached into
 * this table — which is exactly how #5775's `displayField` / `searchFields`
 * stayed listed here as apparently-valid spelling (#6629). A retired key listed
 * in a live rule is the ADR-0078 reader face: the next author infers the
 * spelling is current.
 *
 * This closes that residue class table-wide rather than per-incident: every prop
 * name the table declares must exist on the corresponding `ComponentPropsMap`
 * schema and must not be a `retiredKey()` tombstone (`never`-typed once the
 * optional wrapper is unwrapped — the shape
 * `packages/spec/src/shared/retired-key.ts` constructs, and the same
 * introspection `packages/spec/src/ui/theme.test.ts` uses to assert the
 * tombstone route). The next retirement that forgets this table goes red HERE,
 * naming the entry, instead of surviving as dead spelling.
 *
 * ── Why the detector is self-tested ─────────────────────────────────────
 *
 * The reconciliation below is a "no violations" assertion, so it passes both
 * when the table is clean AND when {@link isRetiredTombstone} has stopped
 * recognising a tombstone at all — a zod internals change is enough to disarm it
 * into permanent green with nothing to show for it. So the detector is pinned
 * against a KNOWN tombstone and a KNOWN live key from the very schema this issue
 * is about, which is what keeps the gate falsifiable rather than decorative.
 *
 * Deliberately NOT covered:
 * - `record:related_list` — special-cased off the table (`RELATED_LIST_TYPE`);
 *   its props are read structurally by `relatedListFieldRefs`, not declared as a
 *   name list this test could reconcile.
 * - The `fields[]` shape INSIDE a `nestedSections` entry — that is the walker's
 *   business. This test pins that the section prop itself (`sections`) is a live
 *   key.
 */

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { COMPONENT_FIELD_SPECS } from './validate-page-field-bindings.js';

/** As much of a zod (v4) node as this file reads. */
interface ZodDef {
  type?: string;
  shape?: Record<string, unknown>;
  in?: unknown;
  getter?: () => unknown;
  innerType?: unknown;
}

function defOf(node: unknown): ZodDef | undefined {
  return (node as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def;
}

/**
 * Resolve a props schema to its object shape. Tolerates the two wrappers the
 * spec composes over plain objects — `.transform()` pipes (`def.in`) and
 * `z.lazy` (`def.getter`); `lazySchema` proxies resolve transparently on the
 * `_zod` read itself.
 */
function shapeOf(schema: unknown): Record<string, unknown> | undefined {
  let def = defOf(schema);
  for (let hops = 0; def && !def.shape && hops < 4; hops++) {
    if (def.type === 'pipe') def = defOf(def.in);
    else if (def.type === 'lazy' && def.getter) def = defOf(def.getter());
    else break;
  }
  return def?.shape;
}

/**
 * A `retiredKey()` tombstone is `z.never().optional().describe(…)`: unwrap the
 * optional/default wrapper chain and look for `never` at the core.
 */
function isRetiredTombstone(propSchema: unknown): boolean {
  let node: unknown = propSchema;
  for (let hops = 0; defOf(node)?.innerType && hops < 8; hops++) node = defOf(node)?.innerType;
  return defOf(node)?.type === 'never';
}

const map = ComponentPropsMap as unknown as Record<string, unknown>;

describe('COMPONENT_FIELD_SPECS liveness against ComponentPropsMap (#6629)', () => {
  // ── 0. the detector, before anything is asserted THROUGH it ─────────────
  describe('the tombstone detector actually detects (anti-vacuity)', () => {
    // `element:record_picker` is the incident's own schema, and it carries both
    // halves of the discrimination at once: `labelField` live, `displayField`
    // and `searchFields` tombstoned by #5775. If any of these four assertions
    // goes red the reconciliation below is reporting nothing, whatever colour
    // it shows.
    const shape = shapeOf(map['element:record_picker']);

    it('reaches a real object shape through the lazySchema proxy', () => {
      expect(shape, 'ElementRecordPickerPropsSchema resolved to no object shape').toBeDefined();
      // Both spellings are PRESENT in the shape — that is the tombstone route
      // (declared-but-unwritable), and it is why "absent from the shape" and
      // "retired" have to be two separate verdicts below.
      expect(Object.keys(shape!)).toEqual(expect.arrayContaining(['labelField', 'displayField', 'searchFields']));
    });

    it.each(['displayField', 'searchFields'])('recognises the #5775 `%s` tombstone', (key) => {
      expect(isRetiredTombstone(shape![key])).toBe(true);
    });

    it('does not mistake the live `labelField` for one', () => {
      expect(isRetiredTombstone(shape!.labelField)).toBe(false);
    });
  });

  // ── 1. the reconciliation ───────────────────────────────────────────────
  it('names only types that have a registered props schema', () => {
    // The component-type universe is open (`z.union([PageComponentType,
    // z.string()])`), so an unregistered type in the table would not be wrong
    // per se — but every entry today is registered, and an unregistered one
    // could never be reconciled below. If a future entry must name an
    // unregistered type, exempt it here explicitly with the reasoning.
    const unregistered = Object.keys(COMPONENT_FIELD_SPECS).filter((type) => !map[type]);
    expect(unregistered).toEqual([]);
  });

  it('every prop the table names is a live, non-retired key on its schema', () => {
    const violations: string[] = [];
    for (const [type, spec] of Object.entries(COMPONENT_FIELD_SPECS)) {
      const schema = map[type];
      if (!schema) continue; // reported by the registration pin above
      const shape = shapeOf(schema);
      if (!shape) {
        violations.push(`${type}: props schema has no resolvable object shape`);
        continue;
      }
      for (const prop of [...(spec.props ?? []), ...(spec.nestedSections ?? [])]) {
        if (!(prop in shape)) {
          violations.push(
            `${type}.${prop}: not declared on its ComponentPropsMap schema — ` +
              'either a typo in COMPONENT_FIELD_SPECS or a schema key that was removed outright',
          );
        } else if (isRetiredTombstone(shape[prop])) {
          violations.push(
            `${type}.${prop}: RETIRED on its ComponentPropsMap schema (retiredKey tombstone) — ` +
              'no spec-conformant page can carry it, and the #5068 props gate already reports it ' +
              'by name with its rename/delete prescription, so this entry only adds a second ' +
              'finding about a key that no longer exists; drop it (the #5775/#6629 residue class)',
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the record_picker entry is exactly the #5775 survivor set', () => {
    // The incident pin under the general rule above, and NOT redundant with it:
    // the reconciliation is silent about a prop that is simply gone, so dropping
    // `labelField` would leave it green with nothing left to check. This is the
    // half that notices.
    expect(COMPONENT_FIELD_SPECS['element:record_picker']).toEqual({ props: ['labelField'] });
  });
});
