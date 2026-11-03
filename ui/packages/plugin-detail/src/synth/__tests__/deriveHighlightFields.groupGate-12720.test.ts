/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12720 — the header strip never shows a member of a field group
 * whose `visibleWhen` the details body gates, unless the author put it there.
 *
 * The reported shape: an object with no `highlightFields` and one gated group,
 * `pro_details`, `visibleWhen: "record.kind == 'pro'"`. On a `basic` record the
 * body hid the group (objectui#11630) while the heuristic strip, which never
 * read `fieldGroups`, made `pro_secret_note` a chip with its value.
 *
 * Since objectstack#28868 nothing is guessed: an object that declares no
 * `highlightFields` has no strip, so no gated member can reach one, and the
 * body, the one place the predicate is evaluated, draws every member with its
 * group. A DECLARED entry inside a gated group is left as the author wrote it.
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

describe('no strip member is a gated group member the author did not declare (objectui#12720)', () => {
  it('the card shape: an object declaring no highlightFields has no strip at all', () => {
    expect(deriveHighlightFields(cardObject(), null)).toEqual([]);
    // Control: the ungated group adds nothing either; nothing is guessed.
    expect(deriveHighlightFields(cardObject(NO_GATE), null)).toEqual([]);
  });

  it('a DECLARED highlightFields entry inside a gated group is left as written (out of scope)', () => {
    const def = { ...cardObject(), highlightFields: ['pro_secret_note', 'kind'] };
    expect(deriveHighlightFields(def, null)).toEqual(['pro_secret_note', 'kind']);
  });

  it('the synthesized page: no strip, and the body hides nothing, so the gated group is the body\'s to draw', () => {
    const page = buildDefaultPageSchema(cardObject());
    expect(nodesOfType(page, 'record:highlights')).toEqual([]);
    const [details] = nodesOfType(page, 'record:details');
    expect(details?.properties?.hideFields).toBeUndefined();
    expect(details?.properties?.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ group: 'pro_details' })]),
    );
  });
});
