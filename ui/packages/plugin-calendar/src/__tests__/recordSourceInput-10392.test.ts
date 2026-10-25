/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10392 — the calendar registrations stop claiming `objectName` is
 * required. The calendar sibling of objectui#7470 (map and gantt).
 *
 * `ObjectCalendar` reads its records from the shared record-source ladder —
 * `data`, then `staticData`, then `objectName` — and `ObjectCalendarSchema`
 * carries `requireRecordSource('object-calendar')` (objectui#6939): one of the
 * three must be present, none is required alone. The shared input list still
 * declared `objectName` with `required: true`, so `sdui-parser`'s
 * `validateTree` raised a `missing-required-prop` ERROR on a `staticData`-only
 * calendar that the schema accepts.
 *
 * Both tags publish ONE list (`OBJECT_CALENDAR_INPUTS`, objectui#8201), so the
 * rows run per tag: a list that stopped being shared would red one tag here.
 *
 * Rows, per tag:
 * 1. `objectName` is declared (non-vacuity) and is not required.
 * 2. Its description names the three record sources and the schema refusal.
 * 3. The html tier accepts a block authored on `staticData` alone, and on
 *    `data` alone: no `missing-required-prop`, and no diagnostic at all.
 * 4. Control for row 3: the same `validateTree` call still reports a bogus
 *    key, so an empty list is a reading of THIS tag, not of an unresolved one.
 *    The node is bound by `objectName`, so the row holds before and after the
 *    fix alike: it is a control, not a second pin.
 *
 * And once, for the schema the description names:
 * 5. `ObjectCalendarSchema` refuses a block with no record source, with the
 *    refinement's own code — "one of the three" is still enforced, now only
 *    where it is declared.
 * 6. Control: the same schema accepts the `staticData`-only block row 3 uses.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ObjectCalendarSchema } from '@object-ui/types/zod';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const CALENDAR_TAGS = [
  { label: 'object-calendar', type: 'object-calendar', namespace: 'plugin-calendar' },
  { label: 'view:calendar', type: 'calendar', namespace: 'view' },
] as const;

const CALENDAR_CONFIG = { startDateField: 'start', titleField: 'name' };
const ROWS = [{ id: 'r1', name: 'One', start: '2026-01-05' }];

const objectNameInput = (type: string, namespace: string) =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []).find(
    (i: any) => i.name === 'objectName',
  );

const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnosticsOf = (node: Record<string, unknown>) =>
  validateTree(node as never, liveManifest()).diagnostics;

describe('objectui#10392 — calendar registrations do not declare objectName required', () => {
  it.each(CALENDAR_TAGS)('$label — objectName is declared and not required', ({ type, namespace }) => {
    const input = objectNameInput(type, namespace);
    expect(input, `${type} declares objectName`).toBeDefined();
    expect(input.required).not.toBe(true);
  });

  it.each(CALENDAR_TAGS)('$label — the description names the three record sources', ({ type, namespace }) => {
    const description: string = objectNameInput(type, namespace)?.description ?? '';
    for (const key of ['`data`', '`staticData`', '`objectName`']) {
      expect(description).toContain(key);
    }
    expect(description).toContain('`object-calendar` schema refuses');
  });

  it.each(CALENDAR_TAGS)(
    '$label — the html tier accepts a staticData-only calendar with no missing-required-prop',
    ({ type }) => {
      const diagnostics = diagnosticsOf({ type, calendar: CALENDAR_CONFIG, staticData: ROWS });
      expect(diagnostics.map((d) => d.code)).not.toContain('missing-required-prop');
      expect(diagnostics).toEqual([]);
    },
  );

  it.each(CALENDAR_TAGS)(
    '$label — the html tier accepts a data-only calendar with no missing-required-prop',
    ({ type }) => {
      const diagnostics = diagnosticsOf({ type, calendar: CALENDAR_CONFIG, data: ROWS });
      expect(diagnostics.map((d) => d.code)).not.toContain('missing-required-prop');
      expect(diagnostics).toEqual([]);
    },
  );

  it.each(CALENDAR_TAGS)('$label — control: a bogus key is still reported', ({ type }) => {
    const diagnostics = diagnosticsOf({ type, calendar: CALENDAR_CONFIG, objectName: 'event', bogusProp: 'x' });
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['unknown-prop', `<${type}> has no prop "bogusProp"`],
    ]);
  });

  it('the schema the description names refuses a block with no record source', () => {
    const parsed = ObjectCalendarSchema.safeParse({ type: 'object-calendar', calendar: CALENDAR_CONFIG });
    expect(parsed.success).toBe(false);
    const codes = parsed.success
      ? []
      : parsed.error.issues.map((issue: any) => issue.params?.code);
    expect(codes).toContain('RECORD_SOURCE_REQUIRED');
  });

  it('control: the same schema accepts a block authored on staticData alone', () => {
    const parsed = ObjectCalendarSchema.safeParse({
      type: 'object-calendar',
      calendar: CALENDAR_CONFIG,
      staticData: ROWS,
    });
    expect(parsed.success).toBe(true);
  });
});
