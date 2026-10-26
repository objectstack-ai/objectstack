/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `validateChildren` descends the node slots declared for the node's type
 * (objectui#11170), not `children` alone.
 *
 * The subject under every slot is a node the validator already refuses when it
 * sits under `children` — the retired `crud` spelling, `RETIRED_TYPE` — so
 * what each case measures is REACH: the same node, judged or not judged,
 * decided by its position. The path is pinned the way this validator spells
 * paths (`schema.children[0]` → `schema.items[0].content`).
 */

import { describe, expect, it } from 'vitest';
import { nodeSlotsFor } from '@object-ui/types';
import { validateSchema } from '../schema-validator';

const RETIRED = { type: 'crud', columns: [] };
const errorPaths = (schema: unknown) => validateSchema(schema).errors.map((e) => `${e.code} @ ${e.path}`);

describe('core: slot-held nodes are validated, with the slot path (objectui#11170)', () => {
  it('a direct slot: `dialog.content`', () => {
    expect(nodeSlotsFor('dialog').map((s) => s.path)).toContain('content');
    expect(errorPaths({ type: 'dialog', content: RETIRED })).toEqual(['RETIRED_TYPE @ schema.content.type']);
    expect(errorPaths({ type: 'dialog', content: [{ type: 'text' }, RETIRED] })).toEqual([
      'RETIRED_TYPE @ schema.content[1].type',
    ]);
  });

  it('a panel list: `tabs.items[].content`', () => {
    expect(errorPaths({ type: 'tabs', items: [{ value: 'a', content: [{ type: 'text' }] }, { value: 'b', content: RETIRED }] })).toEqual([
      'RETIRED_TYPE @ schema.items[1].content.type',
    ]);
  });

  it('a page’s `regions[].components`, and the retired `body` on `page:card` that its renderer still paints', () => {
    expect(errorPaths({ type: 'page', regions: [{ name: 'main', components: [RETIRED] }] })).toEqual([
      'RETIRED_TYPE @ schema.regions[0].components[0].type',
    ]);
    expect(nodeSlotsFor('page:card').find((s) => s.path === 'body')?.retired).toBe(true);
    expect(errorPaths({ type: 'page:card', body: [RETIRED] })).toEqual(['RETIRED_TYPE @ schema.body[0].type']);
  });

  it('nested: a slot under a child under a slot, every hop in the path', () => {
    const doc = {
      type: 'flex',
      children: [{ type: 'dialog', content: { type: 'tabs', items: [{ value: 'a', content: RETIRED }] } }],
    };
    expect(errorPaths(doc)).toEqual(['RETIRED_TYPE @ schema.children[0].content.items[0].content.type']);
  });

  describe('reach is decided by the declaration, never by the shape of the value', () => {
    it('`body` on a type whose renderer does not read it is NOT descended (objectui#6771 stands)', () => {
      expect(nodeSlotsFor('badge')).toEqual([]);
      expect(errorPaths({ type: 'badge', body: [RETIRED] })).toEqual([]);
      // The control: the same list under `children` on the same type is judged.
      expect(errorPaths({ type: 'badge', children: [RETIRED] })).toEqual(['RETIRED_TYPE @ schema.children[0].type']);
    });

    it('a key that is not a slot of this type is not descended, even when it is one elsewhere', () => {
      // `content` is `dialog`'s slot and `button`'s nothing.
      expect(errorPaths({ type: 'button', content: RETIRED })).toEqual([]);
      // `footer` is `card`'s slot; a `tabs` node has no such position.
      expect(errorPaths({ type: 'tabs', footer: RETIRED })).toEqual([]);
    });

    it('a form’s `fields[]` and a grid’s `columns[]` are definitions, not nodes (PR #11126, ablation 2)', () => {
      expect(errorPaths({ type: 'form', fields: [{ name: 'x', type: 'crud' }] })).toEqual([]);
      expect(errorPaths({ type: 'grid', columns: [{ type: 'crud' }] })).toEqual([]);
    });

    it('a primitive or an absent slot is skipped, not an error', () => {
      expect(validateSchema({ type: 'dialog', trigger: 'Open', content: 0, footer: null }).valid).toBe(true);
      expect(validateSchema({ type: 'tabs', items: ['not-a-panel', { value: 'a' }] }).valid).toBe(true);
    });
  });
});
