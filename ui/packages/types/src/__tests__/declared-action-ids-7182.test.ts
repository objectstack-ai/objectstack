/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `resolveDeclaredActionIds` — the ONE rule for an authored action array (objectui#7182, maintainer ruling 2026-09-02, option C:
 * 「7189 A  其他同意」, "其他同意" covering this card's recommendation C).
 *
 * The rule, in the ruling's words: an `actions` array on `page:header` or
 * `record:quick_actions` is either all action ids or all inline `ActionDef`
 * objects; a mixed `['convert', { … }]` array is refused loudly, with the
 * offending index named, not tolerated by one renderer and half-drawn by the
 * other. Before this function existed the two renderers each carried a
 * hand-written copy of the lookup and disagreed on exactly that input.
 *
 * These cases pin the FUNCTION. The renderers' halves — that both call it, and
 * that both draw the same buttons for the same authored array — are pinned
 * where the renderers live (`page-header-action-ids.test.tsx`,
 * `record-quick-actions.declared-action-ids-7182.test.tsx`, and the
 * two-renderer pin `declaredActionIds.twoRenderers-7182.test.tsx`).
 */

import { describe, it, expect } from 'vitest';
import { actionRendersAt, resolveDeclaredActionIds } from '../ui-action';
import * as barrel from '../index';

const CONVERT = { name: 'convert', label: 'Convert Lead', locations: ['record_header'] };
const QUALIFY = { name: 'qualify', label: 'Qualify', locations: ['record_header'] };
/** A second registration under an already-taken name — registration order must win. */
const CONVERT_AGAIN = { name: 'convert', label: 'Convert (duplicate)' };
/** Registrations the resolver must skip without choking: no name, or not a string. */
const NAMELESS = { label: 'No name' } as { name?: unknown; label: string };
const REGISTERED = [CONVERT, QUALIFY, CONVERT_AGAIN, NAMELESS];

const RULE = 'mixed id/object action arrays are refused; use all ids or all objects';

describe('resolveDeclaredActionIds — all ids (objectui#7182)', () => {
  it('resolves every id against the registered actions, in AUTHORED order', () => {
    // Authored in the reverse of registration order, so "authored order" is a
    // measurement and not a restatement of the registry.
    const out = resolveDeclaredActionIds(['qualify', 'convert'], REGISTERED);
    expect(out.kind).toBe('ids');
    if (out.kind !== 'ids') throw new Error('unreachable');
    expect(out.ids).toEqual(['qualify', 'convert']);
    // The SAME objects, not copies: the renderers key their memo chains on identity.
    expect(out.actions[0]).toBe(QUALIFY);
    expect(out.actions[1]).toBe(CONVERT);
    expect(out.unresolved).toEqual([]);
  });

  it('reports an id that names no registered action, with its index, and resolves the rest', () => {
    const out = resolveDeclaredActionIds(['convert', 'covert_lead'], REGISTERED);
    if (out.kind !== 'ids') throw new Error(`expected ids, got ${out.kind}`);
    expect(out.actions).toEqual([CONVERT]);
    expect(out.unresolved).toEqual([{ index: 1, id: 'covert_lead' }]);
  });

  it('with no registry yet (a lookup in flight) every id is unresolved and NOTHING is refused', () => {
    // The caller owns the loading state; this is data for it, not a verdict.
    for (const registry of [undefined, null, []]) {
      const out = resolveDeclaredActionIds(['convert'], registry);
      expect(out.kind).toBe('ids');
      if (out.kind !== 'ids') throw new Error('unreachable');
      expect(out.actions).toEqual([]);
      expect(out.unresolved).toEqual([{ index: 0, id: 'convert' }]);
    }
  });

  it('a duplicate registered name resolves to the FIRST registration', () => {
    const out = resolveDeclaredActionIds(['convert'], REGISTERED);
    if (out.kind !== 'ids') throw new Error('unreachable');
    expect(out.actions[0]).toBe(CONVERT);
    expect(out.actions[0]).not.toBe(CONVERT_AGAIN);
  });
});

describe('resolveDeclaredActionIds — all inline objects (transition tolerance)', () => {
  it('passes the authored objects through untouched, and never consults the registry', () => {
    const adhoc = { name: 'adhoc', label: 'Ad Hoc' };
    // A registry that would resolve `adhoc` to something ELSE — it must not be read.
    const decoy = [{ name: 'adhoc', label: 'Decoy' }];
    const out = resolveDeclaredActionIds([adhoc, CONVERT], decoy);
    expect(out.kind).toBe('objects');
    if (out.kind !== 'objects') throw new Error('unreachable');
    expect(out.actions[0]).toBe(adhoc);
    expect(out.actions[1]).toBe(CONVERT);
  });

  it('an empty array has nothing to classify and passes through as an empty object list', () => {
    expect(resolveDeclaredActionIds([], REGISTERED)).toEqual({ kind: 'objects', actions: [] });
    expect(resolveDeclaredActionIds([], undefined)).toEqual({ kind: 'objects', actions: [] });
  });
});

describe('resolveDeclaredActionIds — a mixed array is REFUSED, naming the offending index', () => {
  it('an object after an id: refused at the object (index 1)', () => {
    const out = resolveDeclaredActionIds(['convert', { name: 'adhoc' }], REGISTERED);
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.index).toBe(1);
    expect(out.message).toContain('element 1 is an inline action object');
    expect(out.message).toContain('element 0 is an action id');
    expect(out.message).toContain(RULE);
  });

  it('an id after an object: refused at the id (index 1) — the rule is symmetric', () => {
    const out = resolveDeclaredActionIds([{ name: 'adhoc' }, 'convert'], REGISTERED);
    if (out.kind !== 'refused') throw new Error(`expected refused, got ${out.kind}`);
    expect(out.index).toBe(1);
    expect(out.message).toContain('element 1 is an action id');
    expect(out.message).toContain('element 0 is an inline action object');
  });

  it('names the FIRST disagreeing index, however deep it sits', () => {
    const out = resolveDeclaredActionIds(['convert', 'qualify', { name: 'x' }, 'convert'], REGISTERED);
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.index).toBe(2);
  });

  it('an element that is neither an id nor an object is refused at its index, and says what it is', () => {
    const cases: Array<[unknown[], number, string]> = [
      [[null], 0, 'null'],
      [['convert', 3], 1, 'a number'],
      [[['convert']], 0, 'an array'],
      [[{ name: 'x' }, true], 1, 'a boolean'],
      [['convert', undefined], 1, 'a undefined'],
    ];
    for (const [elements, index, what] of cases) {
      const out = resolveDeclaredActionIds(elements, REGISTERED);
      if (out.kind !== 'refused') throw new Error(`expected refused for ${JSON.stringify(elements)}`);
      expect(out.index).toBe(index);
      expect(out.message).toContain(`element ${index} is ${what}`);
      expect(out.message).toContain('neither an action id (a string) nor an inline action object');
    }
  });

  it('a refused array resolves NOTHING — no partial result rides along with the refusal', () => {
    const out = resolveDeclaredActionIds(['convert', { name: 'adhoc' }], REGISTERED);
    expect(Object.keys(out).sort()).toEqual(['index', 'kind', 'message']);
  });
});

describe('the registry-independent verdict — what a renderer reads BEFORE its lookup', () => {
  /**
   * A renderer must decide whether to request a metadata read before it has
   * the registry to resolve against (hooks run every render). The contract
   * review on objectui#7182 kept the shape classifier module-internal: the
   * ONE public function answers that question when called with no registry.
   */
  it('called with no registry, kind and ids are already final and agree with the resolved call', () => {
    const populations: unknown[][] = [
      ['convert'],
      ['convert', 'qualify'],
      [CONVERT],
      [CONVERT, QUALIFY],
      [],
      ['convert', CONVERT],
      [CONVERT, 'convert'],
      [null],
      ['convert', 7],
    ];
    for (const elements of populations) {
      const before = resolveDeclaredActionIds(elements, undefined);
      const after = resolveDeclaredActionIds(elements, REGISTERED);
      expect(before.kind, JSON.stringify(elements)).toBe(after.kind);
      if (before.kind === 'ids' && after.kind === 'ids') expect(before.ids).toEqual(after.ids);
      if (before.kind === 'refused' && after.kind === 'refused') {
        expect(before.index).toBe(after.index);
        expect(before.message).toBe(after.message);
      }
    }
  });

  it('answers "is a lookup needed?" from the shape alone: ids carry their ids (all unresolved), objects carry the objects', () => {
    expect(resolveDeclaredActionIds(['convert', 'qualify'], undefined)).toEqual({
      kind: 'ids',
      ids: ['convert', 'qualify'],
      actions: [],
      unresolved: [{ index: 0, id: 'convert' }, { index: 1, id: 'qualify' }],
    });
    expect(resolveDeclaredActionIds([CONVERT], undefined)).toEqual({ kind: 'objects', actions: [CONVERT] });
  });
});

describe('published beside actionRendersAt on the @object-ui/types barrel', () => {
  it('exports the one function as a value (the control, actionRendersAt, must hit too)', () => {
    expect(typeof barrel.resolveDeclaredActionIds).toBe('function');
    expect(barrel.resolveDeclaredActionIds).toBe(resolveDeclaredActionIds);
    expect(barrel.actionRendersAt).toBe(actionRendersAt);
  });

  it('does NOT publish the shape classifier — one public function, by contract review', () => {
    // The pre-lookup need is served by `resolveDeclaredActionIds(elements,
    // undefined)` (cases above); a second published function would be a
    // permanent surface for a need the first already covers.
    expect('classifyDeclaredActions' in barrel).toBe(false);
  });
});
