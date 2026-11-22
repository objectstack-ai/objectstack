// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `validateObjectPinnedActions`: a pinned header action
 * that names no action of the object, or one not placed on the page its arm
 * pins, is refused at `error` with the reason named. The object's own pins and
 * an extension's (against the object it extends) are judged; an extension of
 * an object the stack does not define, and the `$` built-ins, are not.
 */

import { describe, expect, it } from 'vitest';
import {
  OBJECT_PINNED_ACTION_NOT_PLACED,
  OBJECT_PINNED_ACTION_UNKNOWN,
  validateObjectPinnedActions,
} from './validate-object-pinned-actions.js';
import { AUTHORING_RULES } from './authoring-rules.js';
import * as barrel from './index.js';

const LEAD = {
  name: 'crm_lead',
  fields: { title: { type: 'text' } },
  actions: [
    { name: 'convert_lead', label: 'Convert', locations: ['record_header'] },
    { name: 'log_call', label: 'Log call', locations: ['record_more'] },
    { name: 'mass_assign', label: 'Assign', locations: ['list_toolbar'] },
    { name: 'headless', label: 'Headless', locations: [] },
  ],
};

const stack = (extra: Record<string, unknown> = {}, pinnedActions?: unknown) => ({
  objects: [{ ...LEAD, ...(pinnedActions ? { pinnedActions } : {}) }],
  actions: [{ name: 'send_email', objectName: 'crm_lead', label: 'Send email', locations: ['record_header', 'list_toolbar'] }],
  ...extra,
});

const rules = (s: Record<string, unknown>) => validateObjectPinnedActions(s).map((f) => `${f.rule} ${f.path}`);

describe('validateObjectPinnedActions (objectstack#36366)', () => {
  it('passes pins of placed actions, own and stack-bound, and the $ built-ins', () => {
    expect(rules(stack({}, { record: ['convert_lead', 'log_call', 'send_email'], list: ['$export', 'mass_assign', 'send_email'] }))).toEqual([]);
    expect(rules(stack())).toEqual([]);
  });

  it('refuses a name no action of the object has, at error, naming it', () => {
    const [finding] = validateObjectPinnedActions(stack({}, { record: ['convert_lead', 'close_lead'] }));
    expect(finding).toMatchObject({
      severity: 'error',
      rule: OBJECT_PINNED_ACTION_UNKNOWN,
      where: 'object "crm_lead"',
      path: 'objects[0].pinnedActions.record[1]',
    });
    expect(finding.message).toContain('"close_lead"');
  });

  it('refuses an action not placed on the page its arm pins', () => {
    expect(rules(stack({}, { list: ['convert_lead'], record: ['mass_assign', 'headless'] }))).toEqual([
      `${OBJECT_PINNED_ACTION_NOT_PLACED} objects[0].pinnedActions.list[0]`,
      `${OBJECT_PINNED_ACTION_NOT_PLACED} objects[0].pinnedActions.record[0]`,
      `${OBJECT_PINNED_ACTION_NOT_PLACED} objects[0].pinnedActions.record[1]`,
    ]);
  });

  it('judges an extension against the object it extends, and skips one whose object the stack does not define', () => {
    const s = stack({
      objectExtensions: [
        { extend: 'crm_lead', pinnedActions: { record: ['send_email', 'nope'] } },
        { extend: 'sys_user', pinnedActions: { record: ['anything'] } },
      ],
    });
    expect(rules(s)).toEqual([`${OBJECT_PINNED_ACTION_UNKNOWN} objectExtensions[0].pinnedActions.record[1]`]);
  });

  it('is a gating rule on all three commands, CLI only with its reason, and its ids are on the barrel', () => {
    const rule = AUTHORING_RULES.find((r) => r.name === 'validateObjectPinnedActions');
    expect(rule).toMatchObject({ tier: 'gating', surfaces: ['cli'] });
    expect(rule?.surfaceReason).toMatch(/snapshot/);
    expect(barrel.OBJECT_PINNED_ACTION_UNKNOWN).toBe('object-pinned-action-unknown');
    expect(barrel.OBJECT_PINNED_ACTION_NOT_PLACED).toBe('object-pinned-action-not-placed');
  });
});
