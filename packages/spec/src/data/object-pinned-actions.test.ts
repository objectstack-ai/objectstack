// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `pinnedActions`, the actions each page header of an
 * object shows as buttons. Optional with no default; the shape refuses, with a
 * named reason, more than three, an entry pinned twice, an entry that is
 * neither an action name nor a `$` built-in, and a built-in the page does not
 * have. The object extension carries the same shape.
 */

import { describe, expect, it } from 'vitest';
import { ObjectExtensionSchema, ObjectSchema } from './object.zod';
import {
  OBJECT_PINNED_ACTION_LIMIT,
  OBJECT_PINNED_BUILTIN_ACTIONS,
  OBJECT_PINNED_ACTIONS_SCHEMA,
} from './object-pinned-actions';

const object = (pinnedActions?: unknown) => ({
  name: 'crm_lead',
  fields: { title: { type: 'text' } },
  ...(pinnedActions === undefined ? {} : { pinnedActions }),
});

function refusal(pinnedActions: unknown): string[] {
  const r = ObjectSchema.safeParse(object(pinnedActions));
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('pinnedActions (objectstack#36366)', () => {
  it('is optional with no default: an object without it parses without it', () => {
    const r = ObjectSchema.safeParse(object());
    expect(r.success).toBe(true);
    expect(r.success && 'pinnedActions' in r.data).toBe(false);
  });

  it('takes a list arm and a record arm, each up to three, in order', () => {
    const pins = { list: ['$export', 'convert_lead', '$import'], record: ['convert_lead', 'log_call', 'send_email'] };
    const r = ObjectSchema.safeParse(object(pins));
    expect(r.success).toBe(true);
    expect(r.success && r.data.pinnedActions).toEqual(pins);
    expect(ObjectSchema.safeParse(object({ record: [] })).success).toBe(true);
    expect(ObjectSchema.safeParse(object({})).success).toBe(true);
  });

  it('refuses more than three, naming the limit', () => {
    expect(OBJECT_PINNED_ACTION_LIMIT).toBe(3);
    const [message] = refusal({ record: ['a_one', 'a_two', 'a_three', 'a_four'] });
    expect(message).toMatch(/^pinnedActions\.record: `pinnedActions\.record` pins 4 actions; a header draws at most 3/);
  });

  it('refuses an entry pinned twice, at its index', () => {
    expect(refusal({ list: ['convert_lead', 'convert_lead'] })).toEqual([
      'pinnedActions.list.1: `convert_lead` is pinned twice on the list page; a header draws an action once.',
    ]);
  });

  it('refuses an entry that is neither an action name nor a built-in', () => {
    for (const bad of ['Convert', 'convert-lead', 'x', '', 'crm.convert']) {
      const [message] = refusal({ record: [bad] });
      expect(message, bad).toBe(
        `pinnedActions.record.0: \`${bad}\` is not an action name (lowercase snake_case, as the action's \`name\`) ` +
          'nor a built-in (the record page has no built-in, pin an action name).',
      );
    }
  });

  it('refuses a built-in the page does not have, naming the ones it has', () => {
    expect(OBJECT_PINNED_BUILTIN_ACTIONS).toEqual({ list: ['$import', '$export'], record: [] });
    expect(refusal({ list: ['$print'] })).toEqual([
      "pinnedActions.list.0: `$print` is not a built-in of the list page: the list page's built-ins are `$import`, `$export`.",
    ]);
    expect(refusal({ record: ['$export'] })).toEqual([
      'pinnedActions.record.0: `$export` is not a built-in of the record page: the record page has no built-in, pin an action name.',
    ]);
  });

  it('is a closed shape: an unknown arm is refused, a near-miss pointed at its arm', () => {
    expect(refusal({ detail: ['convert_lead'] }).join()).toMatch(/detail/);
    expect(refusal({ recordPage: ['convert_lead'] }).join()).toMatch(/record/);
  });

  it('the object extension carries the same leaf', () => {
    expect(ObjectExtensionSchema.safeParse({ extend: 'crm_lead', pinnedActions: { record: ['log_call'] } }).success).toBe(true);
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_lead', pinnedActions: { record: ['a_one', 'a_two', 'a_three', 'a_four'] } });
    expect(r.success).toBe(false);
    expect(OBJECT_PINNED_ACTIONS_SCHEMA.safeParse(undefined).success).toBe(true);
  });
});
