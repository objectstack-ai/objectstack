/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 → objectstack#27524, Target 5 — the record page's
 * timeline switch and its object-derived default retired with the timeline
 * column (「宽屏时间线放中间不需要了吧」— ruled yes). 动态 is a panel, the
 * first of the right column, for EVERY object: nothing derives from the
 * object where it goes, so a worked object (a stage, option kinds, files)
 * and a container (a price book, a product) synthesize the same strip
 * order. What remains of #27052 is the reader's one switch, ⊟ (the right
 * column), pinned in `RecordPageColumns.switches-27052.test.tsx` and the
 * console's `RecordDetailView.panelToggles-27052.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import * as recordPageColumns from '../recordPageColumns';
import { buildDefaultTabs } from '../buildDefaultPageSchema';

const worked = {
  name: 'crm_lead',
  stageField: 'status',
  enable: { files: true },
  fields: {
    status: {
      type: 'select',
      options: [
        { value: 'new', label: 'New', kind: 'open' },
        { value: 'converted', label: 'Converted', kind: 'won' },
      ],
    },
  },
};
const container = { name: 'price_book', fields: { name: { type: 'text' } } };
const RELATED = [{ objectName: 'task', relationshipField: 'parent_id', title: 'Tasks' }];

const tabValues = (def: any) => buildDefaultTabs(def, { related: RELATED }).properties.items.map((i: any) => i.value);

describe('动态 is a panel for every object (objectstack#27524, Target 5)', () => {
  it('the strip places Timeline second for a worked object and a container alike', () => {
    expect(tabValues(worked)).toEqual(['details', 'timeline', 'related']);
    expect(tabValues(container)).toEqual(['details', 'timeline', 'related']);
  });

  it('the object-derived default and the column switches are gone from the module', () => {
    for (const retired of ['recordTimelineDefaultReason', 'recordPageColumnDefaults', 'recordPageArrangementFor']) {
      expect(recordPageColumns).not.toHaveProperty(retired);
    }
  });
});
