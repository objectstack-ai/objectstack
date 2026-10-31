// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27703] The withheld-mentions write answer, at the contract.
 *
 * The mention recipient gate withholds a notification from a mentioned user
 * who cannot read the comment or its record. The create and update answers
 * tell the author which of the users they named will not be notified: ids
 * only, never the reason, omitted when nobody was withheld. These pins hold
 * the member optional on both answers (an existing client's reading does not
 * move), hold it to ids, and hold the in-process listener that carries the
 * gate's verdict to the answer.
 */

import { describe, it, expect } from 'vitest';
import {
  CreateDataResponseSchema,
  UpdateDataResponseSchema,
  CloneDataResponseSchema,
} from './protocol.zod';
import type { WriteObservabilityOptions } from '../contracts/data-engine';

const base = { object: 'sys_comment', id: 'c1', record: { id: 'c1' } };
const shapeKeys = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape);

describe('[#27703] the create and update answers declare an optional `withheldMentions` of user ids', () => {
  it.each([
    ['CreateDataResponseSchema', CreateDataResponseSchema],
    ['UpdateDataResponseSchema', UpdateDataResponseSchema],
  ] as const)('%s accepts the ids, and an answer with no key', (_name, schema) => {
    expect(schema.safeParse({ ...base, withheldMentions: ['u_bob', 'u_dave'] }))
      .toMatchObject({ success: true, data: { withheldMentions: ['u_bob', 'u_dave'] } });
    expect(schema.safeParse(base)).toMatchObject({ success: true });
    expect((schema.parse(base) as Record<string, unknown>).withheldMentions).toBeUndefined();
  });

  it.each([
    ['CreateDataResponseSchema', CreateDataResponseSchema],
    ['UpdateDataResponseSchema', UpdateDataResponseSchema],
  ] as const)('%s refuses anything but an array of ids: no reason, no object per user', (_name, schema) => {
    expect(schema.safeParse({ ...base, withheldMentions: [{ id: 'u_bob', reason: 'cannot_read_thread' }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, withheldMentions: 'u_bob' }).success).toBe(false);
    expect(schema.safeParse({ ...base, withheldMentions: [7] }).success).toBe(false);
  });

  it('the clone answer does not declare it: the ruling names the create and the update answer only', () => {
    expect(shapeKeys(CloneDataResponseSchema)).not.toContain('withheldMentions');
  });

  it('the description says the member is response-only and carries no reason', () => {
    const describeOf = (schema: unknown) =>
      ((schema as { shape: Record<string, { description?: string }> }).shape.withheldMentions?.description ?? '');
    for (const schema of [CreateDataResponseSchema, UpdateDataResponseSchema]) {
      expect(describeOf(schema)).toMatch(/never stored/);
      expect(describeOf(schema)).toMatch(/never the reason/);
    }
    expect(describeOf(CreateDataResponseSchema)).toBe(describeOf(UpdateDataResponseSchema));
  });
});

describe('[#27703] the listener is declared on the in-process write contract', () => {
  it('`onMentionsWithheld` takes the ids; absent stays legal', () => {
    const seen: string[][] = [];
    const opts: WriteObservabilityOptions = { onMentionsWithheld: (ids) => { seen.push([...ids]); } };
    opts.onMentionsWithheld?.(['u_bob']);
    expect(seen).toEqual([['u_bob']]);
    const unset: WriteObservabilityOptions = {};
    expect(unset.onMentionsWithheld).toBeUndefined();
  });
});
