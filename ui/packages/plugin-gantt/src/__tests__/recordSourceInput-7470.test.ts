/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7470 — the designer face stops claiming `objectName` is required.
 *
 * `ObjectGantt`'s `getDataConfig` reads `data`, then `staticData`, then
 * `objectName`, and the `object-gantt` zod schema carries `requireRecordSource`
 * (objectui#6939): one of the three must be present, none is required alone.
 * The registration still declared `objectName` with `required: true`, so the
 * registry said the opposite of the schema — and `sdui-parser`'s `validateTree`
 * turns a required input into a `missing-required-prop` ERROR, which a
 * `staticData`-only gantt drew while the schema accepted it.
 *
 * Ruled (letter align): drop `required`, state the one-of rule in the
 * description, add no one-of vocabulary to the input declaration.
 *
 * `object-gantt` is the one registration key: the bare `gantt` key is retired
 * (objectui#8008, pinned by `bare-gantt-node-key-retired-8008.test.ts`).
 *
 * Rows:
 * 1. `objectName` is declared (non-vacuity) and is not required.
 * 2. Its description names all three record sources.
 * 3. The description's claim about the schema is TRUE: `ObjectGanttSchema`
 *    refuses a block with none of the three with the refinement's own code,
 *    and accepts a block authored on `staticData` alone.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ObjectGanttSchema } from '@object-ui/types/zod';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const objectNameInput = () =>
  ((ComponentRegistry.getConfig('object-gantt', 'plugin-gantt') as any)?.inputs ?? []).find(
    (i: any) => i.name === 'objectName',
  );

describe('objectui#7470 — the object-gantt registration does not declare objectName required', () => {
  it('objectName is declared and not required', () => {
    const input = objectNameInput();
    expect(input, 'object-gantt declares objectName').toBeDefined();
    expect(input.required).not.toBe(true);
  });

  it('the description names the three record sources', () => {
    const description: string = objectNameInput()?.description ?? '';
    for (const key of ['`data`', '`staticData`', '`objectName`']) {
      expect(description).toContain(key);
    }
    expect(description).toContain('`object-gantt` schema refuses');
  });

  it('the schema the description names refuses a block with no record source', () => {
    const parsed = ObjectGanttSchema.safeParse({ type: 'object-gantt' });
    expect(parsed.success).toBe(false);
    const codes = parsed.success
      ? []
      : parsed.error.issues.map((issue: any) => issue.params?.code);
    expect(codes).toContain('RECORD_SOURCE_REQUIRED');
  });

  it('control: the same schema accepts a block authored on staticData alone', () => {
    const parsed = ObjectGanttSchema.safeParse({
      type: 'object-gantt',
      staticData: [{ id: '1', title: 'Task', start: '2026-01-01', end: '2026-01-02' }],
    });
    expect(parsed.success).toBe(true);
  });
});
