/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28868, as objectstack#35849 / objectstack#35891 changed it — the
 * default record page draws each field in its group.
 *
 * 1. No guessed highlights: an object that declares no `highlightFields` has
 *    none, and nothing is picked from field names or types. The maintainer's
 *    ruling: 「没声明就不挑」 (objectstack#28868, kept by objectstack#35849:
 *    「自动选择的关键字会让人误会」).
 * 2. A declared list is still the author's — the hover card, the related
 *    lists and the record picker read it (`deriveHighlightFields`, minus the
 *    name field, at most six) — but the default page draws no strip for it
 *    (objectstack#35891) and the body takes none of its fields out of their
 *    groups (objectstack#35849: 「后台配的分组原样生效」).
 * 3. The stage likewise: the default page draws no `record:path`; the stage
 *    field stays in its group, and the header's status tag moves it.
 *
 * Until objectstack#35849 the body's `hideFields` left out the strip's fields
 * and the path's stage field; those pins are migrated here to the new rule.
 * The owner rule (the meta line leaves the owner out when the strip carries
 * it) is pinned beside the meta line, in `RecordMetaFooter.ownerOnce-28868.test.tsx`.
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

describe('2. a declared list: still the author\'s, but no strip and no field leaves its group', () => {
  it('deriveHighlightFields still reads the declared list without the title, at most six', () => {
    const def = { ...account, highlightFields: ['name', 'industry', 'owner_id'] };
    expect(deriveHighlightFields(def, null)).toEqual(['industry', 'owner_id']);
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(deriveHighlightFields({ name: 'wide', fields: {}, highlightFields: names }, null)).toEqual(names.slice(0, 6));
  });

  it('the default page has no record:highlights node and the body hides nothing', () => {
    const def = { ...account, highlightFields: ['name', 'industry', 'owner_id'] };
    const page = buildDefaultPageSchema(def);
    expect(nodesOfType(page, 'record:highlights')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('a host passing its declared list in as highlightFields changes neither', () => {
    // RecordDetailView passes the object's list in its synthesized parts.
    const page = buildDefaultPageSchema(account, { highlightFields: ['industry', 'owner_id'] });
    expect(nodesOfType(page, 'record:highlights')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });
});

describe('3. the stage stays in its group; the default page draws no path', () => {
  it('an opportunity with a stage field has no record:path, and the stage stays in the body', () => {
    const page = buildDefaultPageSchema(opportunity());
    expect(nodesOfType(page, 'record:path')).toEqual([]);
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('a declared strip holding the stage hides neither', () => {
    const page = buildDefaultPageSchema(opportunity({ highlightFields: ['amount', 'stage'] }));
    expect(bodyHideFields(page)).toEqual([undefined]);
  });

  it('an authored highlights slot is drawn as written, and still takes nothing out of the body', () => {
    const withPath = buildDefaultPageSchema(opportunity({ stageField: false }), {
      slots: { highlights: { type: 'record:path', properties: { statusField: 'stage' } } },
    });
    expect(nodesOfType(withPath, 'record:path').map((n) => n.properties.statusField)).toEqual(['stage']);
    expect(bodyHideFields(withPath)).toEqual([undefined]);
  });

  it('buildDefaultTabs on its own hides nothing either', () => {
    expect(bodyHideFields(buildDefaultTabs(opportunity()))).toEqual([undefined]);
    expect(bodyHideFields(buildDefaultTabs(opportunity({ highlightFields: ['amount'] })))).toEqual([undefined]);
  });

  it('control: the strip sub-builder still emits the path for a page that places it', () => {
    expect(buildDefaultHighlights(opportunity()).map((n) => n.type)).toEqual(['record:path']);
  });
});
