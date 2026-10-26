/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12720 — the DERIVED header strip never picks a member of a field
 * group whose `visibleWhen` the details body gates.
 *
 * The reported shape: an object with no `highlightFields` and one gated group,
 * `pro_details`, `visibleWhen: "record.kind == 'pro'"`. On a `basic` record the
 * body hid the group (objectui#11630) while the heuristic strip, which never
 * read `fieldGroups`, made `pro_secret_note` a chip with its value.
 *
 * The derivation has no record, so it cannot evaluate the predicate: it
 * declines every member of a gated group, on every record, and the body stays
 * the one place the predicate is evaluated. Which groups count as gated is
 * read through the same derivation the body's gate reads, so a blank
 * `visibleWhen` (which the shared derivation drops, and the body therefore
 * never gates) does not gate the strip either.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDefaultPageSchema,
  deriveHighlightFields,
} from '../buildDefaultPageSchema';

const GATE = "record.kind == 'pro'";

/** Passed for "the group declares no `visibleWhen`". */
const NO_GATE = Symbol('no visibleWhen');

/** The card's object, step 2 of its reproduction. */
const cardObject = (visibleWhen: unknown = GATE): any => ({
  name: 'recheck_gate',
  label: 'QA Gate',
  fields: {
    name: { type: 'text', label: 'Name' },
    kind: {
      type: 'select',
      label: 'Kind',
      options: [
        { value: 'basic', label: 'Basic plan' },
        { value: 'pro', label: 'Pro plan' },
      ],
      defaultValue: 'basic',
    },
    pro_secret_note: { type: 'text', label: 'Pro secret note', group: 'pro_details' },
    pro_budget: { type: 'number', label: 'Pro budget', group: 'pro_details' },
  },
  fieldGroups: [
    {
      key: 'pro_details',
      label: 'Pro details',
      ...(visibleWhen !== NO_GATE ? { visibleWhen } : {}),
    },
  ],
});

/** Every node of a page tree with the given `type`. */
function nodesOfType(node: any, type: string, out: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const n of node) nodesOfType(n, type, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (node.type === type) out.push(node);
  for (const value of Object.values(node)) nodesOfType(value, type, out);
  return out;
}

describe('deriveHighlightFields skips members of a gated field group (objectui#12720)', () => {
  it('the card shape: no pro_details member is a derived chip', () => {
    expect(deriveHighlightFields(cardObject(), null)).toEqual(['kind']);
  });

  it('control: the same group with no visibleWhen keeps its members eligible', () => {
    // Proves the skip is keyed on the gate, not on group membership.
    expect(deriveHighlightFields(cardObject(NO_GATE), null)).toEqual([
      'kind',
      'pro_secret_note',
      'pro_budget',
    ]);
  });

  it('the envelope spelling gates the same way as the bare string', () => {
    expect(deriveHighlightFields(cardObject({ dialect: 'cel', source: GATE }), null)).toEqual(['kind']);
  });

  it('a blank visibleWhen does not gate the strip, because the body does not gate it either', () => {
    expect(deriveHighlightFields(cardObject(''), null)).toContain('pro_secret_note');
  });

  it('the preferred-name pass is gated too: a gated member named `amount` is not picked', () => {
    const def = cardObject();
    def.fields.amount = { type: 'currency', label: 'Amount', group: 'pro_details' };
    expect(deriveHighlightFields(def, null)).not.toContain('amount');
    // Control: ungated, `amount` is the first preferred name picked.
    def.fields.amount = { type: 'currency', label: 'Amount' };
    expect(deriveHighlightFields(def, null)[0]).toBe('amount');
  });

  it('a DECLARED highlightFields entry inside a gated group is left as written (out of scope)', () => {
    const def = { ...cardObject(), highlightFields: ['pro_secret_note', 'kind'] };
    expect(deriveHighlightFields(def, null)).toEqual(['pro_secret_note', 'kind']);
  });

  it('the synthesized page: neither the strip nor the body hideFields names a gated member', () => {
    const page = buildDefaultPageSchema(cardObject());
    const [strip] = nodesOfType(page, 'record:highlights');
    const [details] = nodesOfType(page, 'record:details');
    expect(strip?.properties?.fields).toEqual(['kind']);
    // The body hides only what the strip shows, so a gated member is the
    // body's to draw (with its group) when the group's predicate is true.
    expect(details?.properties?.hideFields).toEqual(['kind']);
    expect(details?.properties?.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ group: 'pro_details' })]),
    );
  });
});
