// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28000] The save-notice write answer, at the contract.
 *
 * A hook running on a record save tells the person who saved what the save set
 * in motion ("Sent to your manager for approval"). The create and update
 * answers carry that one author-written message as `notice`: info severity,
 * distinct from `warnings`, omitted when no hook set one. These pins hold the
 * member optional on both answers (an existing client's reading does not
 * move), hold it to one non-empty message, and hold the in-process listener a
 * hook calls to set it.
 */

import { describe, it, expect } from 'vitest';
import {
  CreateDataResponseSchema,
  UpdateDataResponseSchema,
  CloneDataResponseSchema,
} from './protocol.zod';
import type { WriteObservabilityOptions } from '../contracts/data-engine';

const base = { object: 'deal', id: 'd1', record: { id: 'd1' } };
const shapeKeys = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape);
const describeOf = (schema: unknown) =>
  ((schema as { shape: Record<string, { description?: string }> }).shape.notice?.description ?? '');

describe('[#28000] the create and update answers declare an optional one-message `notice`', () => {
  it.each([
    ['CreateDataResponseSchema', CreateDataResponseSchema],
    ['UpdateDataResponseSchema', UpdateDataResponseSchema],
  ] as const)('%s accepts the message, and an answer with no key', (_name, schema) => {
    expect(schema.safeParse({ ...base, notice: 'Sent to your manager for approval' }))
      .toMatchObject({ success: true, data: { notice: 'Sent to your manager for approval' } });
    expect(schema.safeParse(base)).toMatchObject({ success: true });
    expect((schema.parse(base) as Record<string, unknown>).notice).toBeUndefined();
  });

  it.each([
    ['CreateDataResponseSchema', CreateDataResponseSchema],
    ['UpdateDataResponseSchema', UpdateDataResponseSchema],
  ] as const)('%s refuses anything but one non-empty message: no list, no object, no empty string', (_name, schema) => {
    expect(schema.safeParse({ ...base, notice: ['a', 'b'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, notice: { message: 'a', severity: 'info' } }).success).toBe(false);
    expect(schema.safeParse({ ...base, notice: '' }).success).toBe(false);
  });

  it('it is a member of its own, beside `warnings`, never folded into it', () => {
    for (const schema of [CreateDataResponseSchema, UpdateDataResponseSchema]) {
      expect(shapeKeys(schema)).toEqual(expect.arrayContaining(['warnings', 'notice']));
    }
  });

  it('the clone answer does not declare it: the card names the single-record create and update answers', () => {
    expect(shapeKeys(CloneDataResponseSchema)).not.toContain('notice');
  });

  it('the description is one sentence shared by both answers, and says it is never stored', () => {
    expect(describeOf(CreateDataResponseSchema)).toBe(describeOf(UpdateDataResponseSchema));
    expect(describeOf(CreateDataResponseSchema)).toMatch(/never\s+stored/);
    expect(describeOf(CreateDataResponseSchema)).toMatch(/LAST one wins/);
  });
});

describe('[#28000] the listener is declared on the in-process write contract', () => {
  it('`onNotice` takes one message; absent stays legal', () => {
    const seen: string[] = [];
    const opts: WriteObservabilityOptions = { onNotice: (message) => { seen.push(message); } };
    opts.onNotice?.('Sent to your manager for approval');
    expect(seen).toEqual(['Sent to your manager for approval']);
    const unset: WriteObservabilityOptions = {};
    expect(unset.onNotice).toBeUndefined();
  });
});
