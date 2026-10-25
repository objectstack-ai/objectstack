/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — `ObjectGanttSchema` declares `viewMode`, DERIVED from the
 * spec's `GanttConfigSchema.viewMode` (objectui#5074; spec half landed
 * upstream first, contract-first sequencing).
 *
 * Three properties are load-bearing, each pinned below:
 *
 * 1. **Derivation, not a fork.** The zod member's inner enum is the spec's own
 *    schema object BY REFERENCE — reference identity is the only check that
 *    distinguishes a derivation from a faithful copy (a copy passes every
 *    value comparison until the next spec release, then drifts silently).
 *    The TS half is pinned by mutual assignability with the spec type, which
 *    is real enforcement because `tsconfig.test.json` compiles this file
 *    (#3009).
 *
 * 2. **Declared keys are validated even under `.passthrough()`** — before this
 *    declaration, `viewMode: 'hour'` parsed green (undeclared key, waved
 *    through); now the member's enum refuses it. That is the accept-set
 *    NARROWING this card knowingly lands for off-enum values, mirroring the
 *    published spec vocabulary.
 *
 * 3. **No default.** An omitted `viewMode` must stay ABSENT after parse: the
 *    renderer lets a persisted layout (persistLayoutKey) seed the granularity
 *    before its 'day' fallback, and a `.default('day')` here would arrive
 *    downstream as an explicit author choice and defeat that seeding
 *    (`ObjectGantt.viewmode.test.tsx` pins the wiring half of the same
 *    semantics).
 */

import { describe, it, expect } from 'vitest';
import { GanttConfigSchema as SpecGanttConfigSchema } from '@objectstack/spec/ui';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import type { ObjectGanttSchema as ObjectGanttSchemaTS, GanttConfig } from '../objectql.js';

const MINIMAL = {
  type: 'object-gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
} as const;

/** Unwrap ZodOptional/description wrappers down to the inner enum schema. */
function unwrap(schema: any): any {
  let cur = schema;
  while (cur?._def?.innerType) cur = cur._def.innerType;
  return cur;
}

describe('ObjectGanttSchema.viewMode — derived from the spec, by reference', () => {
  it('declares the key', () => {
    expect(Object.keys(ObjectGanttSchema.shape)).toContain('viewMode');
  });

  it('its inner enum IS the spec enum object (reference identity, not a copy)', () => {
    const local = unwrap(ObjectGanttSchema.shape.viewMode);
    const spec = unwrap(SpecGanttConfigSchema.shape.viewMode);
    expect(local).toBe(spec);
  });

  it('accepts every member the spec publishes', () => {
    const members: string[] = unwrap(SpecGanttConfigSchema.shape.viewMode).options;
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) {
      const result = ObjectGanttSchema.safeParse({ ...MINIMAL, viewMode: m });
      expect(result.success).toBe(true);
    }
  });

  it('refuses an off-enum value on the viewMode path (declared-key validation under passthrough)', () => {
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, viewMode: 'hour' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'viewMode');
    expect(issue).toBeTruthy();
    expect(issue!.code).toBe('invalid_value');
  });

  it('materialises NO default — an omitted viewMode stays absent after parse', () => {
    const result = ObjectGanttSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('viewMode' in result.data).toBe(false);
  });
});

describe('ObjectGanttSchema (TS) viewMode — mirrors the spec type exactly', () => {
  it('is mutually assignable with the spec member (compile-time pin)', () => {
    // Accepts everything the spec type allows…
    const widen = (v: GanttConfig['viewMode']): ObjectGanttSchemaTS['viewMode'] => v;
    // …and nothing more (assignable back).
    const narrow = (v: ObjectGanttSchemaTS['viewMode']): GanttConfig['viewMode'] => v;
    expect(widen('quarter')).toBe('quarter');
    expect(narrow(undefined)).toBeUndefined();
    // @ts-expect-error — a non-member must be refused at compile time.
    const _rejected: ObjectGanttSchemaTS['viewMode'] = 'hour';
    expect(_rejected).toBe('hour');
  });
});
