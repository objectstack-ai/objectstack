/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28868 — the default record page draws each fact once.
 *
 * 1. No guessed strip: an object that declares no `highlightFields` has no
 *    `record:highlights` node, and the body hides none of its fields. The
 *    maintainer's ruling: 「没声明就不挑」.
 * 2. A declared strip is unchanged: the declared list minus the name field,
 *    at most six, and the body leaves out exactly the fields the strip draws.
 * 3. The stage once: when the page draws `record:path`, its `statusField`
 *    joins the body's `hideFields`.
 *
 * The owner rule (the meta line leaves the owner out when the strip carries
 * it) and the one word for the owner are pinned beside the meta line, in
 * `RecordMetaFooter.ownerOnce-28868.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDefaultHighlights,
  buildDefaultPageSchema,
  buildDefaultTabs,
  deriveHighlightFields,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

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

const bodyHideFields = (page: unknown): unknown =>
  nodesOfType(page, 'record:details').map((n) => n.properties?.hideFields);

/** The card's account: four business fields, no declared highlights, no stage. */
const account: ObjectDefLike = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'select', label: 'Industry', options: [{ value: 'tech', label: 'Tech' }] },
    annual_revenue: { type: 'currency', label: 'Annual revenue' },
    website: { type: 'url', label: 'Website' },
    owner_id: { type: 'lookup', label: 'Owner' },
  },
};

/** The card's opportunity: a stage the path draws. */
const opportunity = (extra: Partial<ObjectDefLike> = {}): ObjectDefLike => ({
  name: 'opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'closed_won', label: 'Closed won' },
      ],
    },
    owner_id: { type: 'lookup', label: 'Owner' },
  },
  ...extra,
});

describe('1. no declared highlightFields: no strip, and the body keeps every field', () => {
  it('nothing is guessed from field names or types', () => {
    // Before this card `owner_id`, `annual_revenue`, `industry` and `website`
    // were all picked, and the body was left with only the name.
    expect(deriveHighlightFields(account, null)).toEqual([]);
    expect(buildDefaultHighlights(account)).toEqual([]);
  });

  it('the default page has no record:highlights node and the body hides nothing', () => {
    const page = buildDefaultPageSchema(account);
    expect(nodesOfType(page, 'record:highlights')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('an empty declared list is the same as none', () => {
    const page = buildDefaultPageSchema({ ...account, highlightFields: [] });
    expect(nodesOfType(page, 'record:highlights')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });
});

describe('2. a declared strip: the declared list minus the name field, max 6', () => {
  it('the strip draws exactly the declared list without the title, and the body leaves out exactly those', () => {
    const def = { ...account, highlightFields: ['name', 'industry', 'owner_id'] };
    expect(deriveHighlightFields(def, null)).toEqual(['industry', 'owner_id']);
    const page = buildDefaultPageSchema(def);
    expect(nodesOfType(page, 'record:highlights').map((n) => n.properties.fields)).toEqual([['industry', 'owner_id']]);
    expect(bodyHideFields(page)).toEqual([['industry', 'owner_id']]);
  });

  it('a declared entry past the sixth is drawn by the body, not dropped from both', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const wide: ObjectDefLike = {
      name: 'wide',
      fields: { name: { type: 'text' }, ...Object.fromEntries(names.map((n) => [n, { type: 'text' }])) },
    };
    // The record page passes its declared list in as `highlightFields`
    // (RecordDetailView's synthesized parts): the strip cuts it at six, and so
    // does the body's hide list.
    const page = buildDefaultPageSchema(wide, { highlightFields: names });
    expect(nodesOfType(page, 'record:highlights').map((n) => n.properties.fields)).toEqual([names.slice(0, 6)]);
    expect(bodyHideFields(page)).toEqual([names.slice(0, 6)]);
  });
});

describe('3. the stage once: the path\'s statusField leaves the body', () => {
  it('an opportunity with a path has no stage field in the body', () => {
    const page = buildDefaultPageSchema(opportunity());
    expect(nodesOfType(page, 'record:path').map((n) => n.properties.statusField)).toEqual(['stage']);
    expect(bodyHideFields(page)).toEqual([['stage']]);
  });

  it('the stage joins a declared strip\'s hide list, once', () => {
    const page = buildDefaultPageSchema(opportunity({ highlightFields: ['amount', 'stage'] }));
    expect(bodyHideFields(page)).toEqual([['amount', 'stage']]);
  });

  it('control: no path (stageField: false), so the stage stays in the body', () => {
    const page = buildDefaultPageSchema(opportunity({ stageField: false }));
    expect(nodesOfType(page, 'record:path')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('control: a status field with no stages to draw is no path, so it stays in the body', () => {
    const def: ObjectDefLike = { name: 'note', fields: { body: { type: 'text' }, status: { type: 'text' } } };
    const page = buildDefaultPageSchema(def);
    expect(nodesOfType(page, 'record:path')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('an authored highlights slot decides: its record:path hides the stage, a slot without one does not', () => {
    const withPath = buildDefaultPageSchema(opportunity({ stageField: false }), {
      slots: { highlights: { type: 'record:path', properties: { statusField: 'stage' } } },
    });
    expect(bodyHideFields(withPath)).toEqual([['stage']]);

    const withoutPath = buildDefaultPageSchema(opportunity(), {
      slots: { highlights: { type: 'div', id: 'custom-strip' } },
    });
    expect(bodyHideFields(withoutPath)).toEqual([undefined]);
  });

  it('buildDefaultTabs on its own hides what the default strip for the same options draws', () => {
    expect(bodyHideFields(buildDefaultTabs(opportunity()))).toEqual([['stage']]);
    expect(bodyHideFields(buildDefaultTabs(opportunity({ stageField: false })))).toEqual([undefined]);
  });
});
