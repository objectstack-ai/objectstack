/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8348 — `object-gantt` is judged against ITS OWN protocol row.
 *
 * Decision batch #83, maintainer verbatim 「8348 以协议为准」: a renderer honours
 * the `data` spelling its block's PUBLISHED row declares. When that ruling
 * landed (objectui#9234) `@objectstack/spec` published no
 * `ComponentPropsMap['object-gantt']` row, so this block was judged through this
 * repo's own `ObjectGanttSchema.data` as an interim. Ruling batch #136 item 3
 * (Q1-C) had the protocol gain the row, and "after it lands, this card's
 * remaining slice judges the three blocks against their protocol rows" — this
 * file is that judgement for the gantt.
 *
 * ⛔ The arm is DERIVED from the installed row at test time, never restated as
 * a constant, so a spec release that moves the row turns this red (AGENTS.md
 * #9). It is compared with the arm table `SchemaRenderer` reads for every key
 * this plugin registers; `ObjectGantt.tsx`'s `rawDataConfig` passes the same
 * literal, and `record-source-config.behaviourNeutrality-7632.test.ts`
 * (`@object-ui/core`) pins what that literal resolves.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers `object-gantt` through this package's own entry.
import '../index';

type DerivedArm = 'view-data' | 'array' | 'no data row' | 'no row' | 'both arms' | 'neither arm';

/**
 * The arm a `ComponentPropsMap` row's `data` member declares — READ from the
 * installed row by parsing one value of each arm, ⛔ never restated. Read
 * through `Record<string, any>` for the reason
 * `ObjectTree.schemaTyped-8655.test.ts` (plugin-tree) gives: `_def` is a zod
 * internal the spec publishes no type for.
 */
function armDeclaredByRow(type: string): DerivedArm {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  if (!entry?._def) return 'no row';
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const data = shape?.data;
  if (!data) return 'no data row';
  const takesObject = data.safeParse({ provider: 'value', items: [] }).success;
  const takesArray = data.safeParse([]).success;
  if (takesObject && takesArray) return 'both arms';
  if (takesObject) return 'view-data';
  if (takesArray) return 'array';
  return 'neither arm';
}

describe('object-gantt is judged against its installed protocol row (objectui#8348)', () => {
  it('every KEY this plugin registers onto the gantt renderer answers the arm the INSTALLED row declares', () => {
    const siblings = ComponentRegistry.getAllTypes().filter(
      (type) => ComponentRegistry.get(type) === ComponentRegistry.get('object-gantt'),
    );
    const declared = armDeclaredByRow('object-gantt');

    expect([...siblings].sort()).toEqual(['object-gantt', 'plugin-gantt:object-gantt']);
    expect(declared).toBe('view-data');
    for (const type of siblings) {
      expect([type, recordSourceDataArmForType(type)]).toEqual([type, declared]);
    }
  });

  it('⛔ CONTROL: the row reader discriminates — the array-arm row and an absent row read differently', () => {
    // Without these, a reader that answered `view-data` for everything would
    // make the row above a restatement instead of a measurement.
    expect(armDeclaredByRow('object-calendar')).toBe('array');
    expect(armDeclaredByRow('BOGUS_CONTROL_BLOCK')).toBe('no row');
  });
});
