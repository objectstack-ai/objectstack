/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE ENUM READER PROVES ITSELF — once, for every parity gate that imports it
 * (objectui#5872).
 *
 * Two halves, and the second is the one that earns the consolidation:
 *
 *   - SYNTHETIC fixtures pin each wrapper spelling the reader claims to walk,
 *     ALONE. The four hand copies this module replaced read exactly one
 *     (`def.innerType`), so the whole value of a shared reader is the spellings
 *     it adds; a fixture set that only exercised the one they already had would
 *     leave every addition untested and free to be silently wrong.
 *   - the REAL `@objectstack/spec` half pins the reader against the four
 *     (schema, key) pairs the converged suites actually ask about, asserting
 *     only that each vocabulary is NON-EMPTY. The names themselves stay
 *     un-pinned here on purpose: each consuming suite pins its own vocabulary
 *     against the renderer it judges, and a copy of those names in this file
 *     would be a fifth place to forget — the exact shape of the problem this
 *     module exists to end.
 *
 * The negative cases matter as much: `[]` is this reader's "could not read",
 * and a reader that returned a non-empty array for a member with no enum at all
 * would turn every consuming suite's non-vacuity assertion into a rubber stamp.
 *
 * ## The second entry point (objectui#6924)
 *
 * `enumOptions(node)` is the same walk entered one step later — for a node that
 * IS the enum rather than a shape carrying one. It gets its own three halves
 * below, and one assertion the others cannot make: that the two entry points
 * AGREE on the same member. That is what makes the delegation observable; a
 * `shapeEnumOptions` that quietly grew a second copy of the walk would still
 * pass every fixture above, and this repository's whole reason for having this
 * module is that a second copy is exactly what nobody notices.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AddRecordConfigSchema,
  ChartAggregateFunctionSchema,
  ChartTypeSchema,
  ColumnSummarySchema,
  NotificationPositionSchema,
  NotificationTypeSchema,
  PageComponentType,
  ReportType,
  SelectionConfigSchema,
  TimelineConfigSchema,
  UserFilterFieldSchema,
  WidgetColorVariantSchema,
} from '@objectstack/spec/ui';
import { FieldType } from '@objectstack/spec/data';

import { enumOptions, shapeEnumOptions } from '../spec-enum-options';

describe('shapeEnumOptions walks every wrapper spelling it claims to', () => {
  const VOCAB = ['alpha', 'beta', 'gamma'] as const;

  it('reads a bare, unwrapped enum member', () => {
    const schema = z.object({ key: z.enum(VOCAB) });
    expect(shapeEnumOptions(schema, 'key')).toEqual([...VOCAB]);
  });

  it('reads through .optional()', () => {
    const schema = z.object({ key: z.enum(VOCAB).optional() });
    expect(shapeEnumOptions(schema, 'key')).toEqual([...VOCAB]);
  });

  it('reads through .default() — the spelling all four hand copies carried', () => {
    const schema = z.object({ key: z.enum(VOCAB).default('alpha') });
    expect(shapeEnumOptions(schema, 'key')).toEqual([...VOCAB]);
  });

  it('reads through a stack of wrappers, not just one level', () => {
    const schema = z.object({ key: z.enum(VOCAB).nullable().optional() });
    expect(shapeEnumOptions(schema, 'key')).toEqual([...VOCAB]);
  });

  it('reads a member of a lazily-resolved shape', () => {
    const inner = z.object({ key: z.enum(VOCAB).optional() });
    // The `lazySchema()` thunk spelling `resolvePropsShape` exists for: the
    // shape is a FUNCTION that must be called before it has any keys at all.
    const thunked = { shape: () => inner.shape };
    expect(shapeEnumOptions(thunked, 'key')).toEqual([...VOCAB]);
  });
});

describe('shapeEnumOptions answers [] rather than guessing', () => {
  it('returns [] for a key the shape does not carry', () => {
    expect(shapeEnumOptions(z.object({ other: z.string() }), 'key')).toEqual([]);
  });

  it('returns [] for a member that is not an enum', () => {
    expect(shapeEnumOptions(z.object({ key: z.string().optional() }), 'key')).toEqual([]);
  });

  it('returns [] for something that is not a schema at all', () => {
    expect(shapeEnumOptions(undefined, 'key')).toEqual([]);
    expect(shapeEnumOptions({}, 'key')).toEqual([]);
  });
});

describe('shapeEnumOptions reads the real contract the parity gates ask about', () => {
  const pairs: ReadonlyArray<readonly [string, unknown, string]> = [
    ['SelectionConfigSchema.type', SelectionConfigSchema, 'type'],
    ['AddRecordConfigSchema.position', AddRecordConfigSchema, 'position'],
    ['UserFilterFieldSchema.type', UserFilterFieldSchema, 'type'],
    ['TimelineConfigSchema.scale', TimelineConfigSchema, 'scale'],
  ];

  it.each(pairs)('reads a non-empty vocabulary for %s', (_label, schema, key) => {
    const options = shapeEnumOptions(schema, key);
    expect(options.length, 'the reader went quietly empty on a live spec enum').toBeGreaterThan(0);
    expect(options.every((name) => typeof name === 'string')).toBe(true);
  });
});

describe('enumOptions walks the same spellings, entered at the node', () => {
  const VOCAB = ['alpha', 'beta', 'gamma'] as const;

  it('reads a bare, unwrapped enum — the shape the 16 converged call sites hold', () => {
    expect(enumOptions(z.enum(VOCAB))).toEqual([...VOCAB]);
  });

  it('reads through .optional()', () => {
    expect(enumOptions(z.enum(VOCAB).optional())).toEqual([...VOCAB]);
  });

  it('reads through .default()', () => {
    expect(enumOptions(z.enum(VOCAB).default('alpha'))).toEqual([...VOCAB]);
  });

  it('reads through a stack of wrappers, not just one level', () => {
    expect(enumOptions(z.enum(VOCAB).nullable().optional())).toEqual([...VOCAB]);
  });

  it('reads a shape member handed in directly, without a key', () => {
    const schema = z.object({ key: z.enum(VOCAB).optional() });
    expect(enumOptions(schema.shape.key)).toEqual([...VOCAB]);
  });
});

describe('enumOptions answers [] rather than guessing', () => {
  it('returns [] for a node that is not an enum', () => {
    expect(enumOptions(z.string().optional())).toEqual([]);
  });

  it('returns [] for an object schema — the enum is not the node, it is inside it', () => {
    // The distinction `shapeEnumOptions` exists for. Silently answering here
    // would make the two entry points interchangeable and hide a mis-call.
    expect(enumOptions(z.object({ key: z.enum(['alpha', 'beta']) }))).toEqual([]);
  });

  it('returns [] for something that is not a schema at all', () => {
    expect(enumOptions(undefined)).toEqual([]);
    expect(enumOptions(null)).toEqual([]);
    expect(enumOptions({})).toEqual([]);
    expect(enumOptions('bare')).toEqual([]);
  });
});

describe('the two entry points are one walk', () => {
  const VOCAB = ['alpha', 'beta', 'gamma'] as const;

  // If `shapeEnumOptions` ever stops delegating, this is the assertion that
  // notices — the wrapper spellings above would keep passing against a copy.
  it.each([
    ['bare', z.object({ key: z.enum(VOCAB) })],
    ['optional', z.object({ key: z.enum(VOCAB).optional() })],
    ['default', z.object({ key: z.enum(VOCAB).default('alpha') })],
    ['stacked', z.object({ key: z.enum(VOCAB).nullable().optional() })],
  ] as const)('shapeEnumOptions(schema, key) === enumOptions(schema.shape[key]) — %s', (_label, schema) => {
    expect(shapeEnumOptions(schema, 'key')).toEqual(enumOptions(schema.shape.key));
    expect(shapeEnumOptions(schema, 'key')).toEqual([...VOCAB]);
  });
});

describe('enumOptions reads the real contract the converged gates ask about', () => {
  const nodes: ReadonlyArray<readonly [string, unknown]> = [
    ['ChartTypeSchema', ChartTypeSchema],
    ['ChartAggregateFunctionSchema', ChartAggregateFunctionSchema],
    ['ColumnSummarySchema', ColumnSummarySchema],
    ['NotificationPositionSchema', NotificationPositionSchema],
    ['NotificationTypeSchema', NotificationTypeSchema],
    ['PageComponentType', PageComponentType],
    ['ReportType', ReportType],
    ['WidgetColorVariantSchema', WidgetColorVariantSchema],
    ['FieldType', FieldType],
  ];

  it.each(nodes)('reads a non-empty vocabulary for %s', (_label, node) => {
    const options = enumOptions(node);
    expect(options.length, 'the reader went quietly empty on a live spec enum').toBeGreaterThan(0);
    expect(options.every((name) => typeof name === 'string')).toBe(true);
  });
});
