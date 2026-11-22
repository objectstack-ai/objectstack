// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `actionLayout`, the order of an object's actions and
 * which are buttons, per action scope. Optional with no default; each arm is
 * `{ pinned, more }`. The shape refuses, with a named reason, more than three
 * pinned, an entry named twice (in one part or in both), an entry that is
 * neither an action name nor a `$` built-in, and a built-in the scope does not
 * have. The object extension carries the same shape.
 */

import { describe, expect, it } from 'vitest';
import { ObjectExtensionSchema, ObjectSchema } from './object.zod';
import {
  OBJECT_ACTION_LAYOUT_BUILTINS,
  OBJECT_ACTION_LAYOUT_PINNED_LIMIT,
  OBJECT_ACTION_LAYOUT_SCHEMA,
} from './object-action-layout';

const object = (actionLayout?: unknown) => ({
  name: 'crm_lead',
  fields: { title: { type: 'text' } },
  ...(actionLayout === undefined ? {} : { actionLayout }),
});

function refusal(actionLayout: unknown): string[] {
  const r = ObjectSchema.safeParse(object(actionLayout));
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('actionLayout (objectstack#36366)', () => {
  it('is optional with no default: an object without it parses without it', () => {
    const r = ObjectSchema.safeParse(object());
    expect(r.success).toBe(true);
    expect(r.success && 'actionLayout' in r.data).toBe(false);
  });

  it('takes a list arm and a record arm, each pinned (up to three) and more, in order', () => {
    const layout = {
      list: { pinned: ['$export', 'convert_lead', '$import'], more: ['mass_update'] },
      record: { pinned: ['convert_lead', 'log_call', 'send_email'], more: ['clone_lead', 'archive_lead'] },
    };
    const r = ObjectSchema.safeParse(object(layout));
    expect(r.success).toBe(true);
    expect(r.success && r.data.actionLayout).toEqual(layout);
    expect(ObjectSchema.safeParse(object({ record: { pinned: [] } })).success).toBe(true);
    expect(ObjectSchema.safeParse(object({ record: { pinned: ['log_call'] } })).success).toBe(true);
    expect(ObjectSchema.safeParse(object({})).success).toBe(true);
  });

  it('an arm states its pinned list: `more` alone is refused', () => {
    expect(refusal({ record: { more: ['log_call'] } }).join()).toMatch(/^actionLayout\.record\.pinned: /);
  });

  it('refuses more than three pinned, naming the limit and where the rest go', () => {
    expect(OBJECT_ACTION_LAYOUT_PINNED_LIMIT).toBe(3);
    const [message] = refusal({ record: { pinned: ['a_one', 'a_two', 'a_three', 'a_four'] } });
    expect(message).toMatch(
      /^actionLayout\.record\.pinned: `actionLayout\.record\.pinned` names 4 actions; at most 3 are drawn as buttons/,
    );
    expect(message).toMatch(/move the rest to `more`\.$/);
  });

  it('refuses an entry named twice in one part, at its index', () => {
    expect(refusal({ list: { pinned: ['convert_lead', 'convert_lead'] } })).toEqual([
      'actionLayout.list.pinned.1: `convert_lead` is named twice in `list.pinned`; an action is drawn once.',
    ]);
    expect(refusal({ record: { pinned: [], more: ['log_call', 'log_call'] } })).toEqual([
      'actionLayout.record.more.1: `log_call` is named twice in `record.more`; an action is drawn once.',
    ]);
  });

  it('refuses an entry named in both parts, at its place in `more`', () => {
    expect(refusal({ record: { pinned: ['close_won'], more: ['clone_deal', 'close_won'] } })).toEqual([
      'actionLayout.record.more.1: `close_won` is named in both `record.pinned` and `record.more`; an action is either a button or in 「More」.',
    ]);
  });

  it('refuses an entry that is neither an action name nor a built-in, in either part', () => {
    for (const bad of ['Convert', 'convert-lead', 'x', '', 'crm.convert']) {
      for (const part of ['pinned', 'more'] as const) {
        const arm = part === 'pinned' ? { pinned: [bad] } : { pinned: [], more: [bad] };
        const [message] = refusal({ record: arm });
        expect(message, `${part} ${bad}`).toBe(
          `actionLayout.record.${part}.0: \`${bad}\` is not an action name (lowercase snake_case, as the action's \`name\`) ` +
            'nor a built-in (the record scope has no built-in, name an action).',
        );
      }
    }
  });

  it('refuses a built-in the scope does not have, naming the ones it has', () => {
    expect(OBJECT_ACTION_LAYOUT_BUILTINS).toEqual({ list: ['$import', '$export'], record: [] });
    expect(refusal({ list: { pinned: ['$print'] } })).toEqual([
      "actionLayout.list.pinned.0: `$print` is not a built-in of the list scope: the list scope's built-ins are `$import`, `$export`.",
    ]);
    expect(refusal({ record: { pinned: [], more: ['$export'] } })).toEqual([
      'actionLayout.record.more.0: `$export` is not a built-in of the record scope: the record scope has no built-in, name an action.',
    ]);
  });

  it('is a closed shape at both levels: an unknown arm or part is refused, a near-miss pointed at its key', () => {
    expect(refusal({ detail: { pinned: ['convert_lead'] } }).join()).toMatch(/record/);
    expect(refusal({ recordPage: { pinned: ['convert_lead'] } }).join()).toMatch(/record/);
    expect(refusal({ record: { pinned: [], overflow: ['log_call'] } }).join()).toMatch(/more/);
    expect(refusal({ record: { buttons: ['log_call'] } }).join()).toMatch(/pinned/);
    // The old per-page array is no arm.
    expect(refusal({ record: ['log_call'] }).length).toBeGreaterThan(0);
  });

  it('the object extension carries the same leaf', () => {
    expect(
      ObjectExtensionSchema.safeParse({ extend: 'crm_lead', actionLayout: { record: { pinned: ['log_call'] } } }).success,
    ).toBe(true);
    const r = ObjectExtensionSchema.safeParse({
      extend: 'crm_lead',
      actionLayout: { record: { pinned: ['a_one', 'a_two', 'a_three', 'a_four'] } },
    });
    expect(r.success).toBe(false);
    expect(OBJECT_ACTION_LAYOUT_SCHEMA.safeParse(undefined).success).toBe(true);
  });
});
