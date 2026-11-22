// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — `validateObjectActionLayout`: a name in an action layout
 * arm (`pinned` or `more`) that names no action of the object, or one not
 * placed in the scope its arm arranges, is refused at `error` with the reason
 * named. The object's own layout and an extension's (against the object it
 * extends) are judged; an extension of an object the stack does not define,
 * and the `$` built-ins, are not.
 */

import { describe, expect, it } from 'vitest';
import {
  OBJECT_ACTION_LAYOUT_NOT_PLACED,
  OBJECT_ACTION_LAYOUT_UNKNOWN,
  validateObjectActionLayout,
} from './validate-object-action-layout.js';
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

const stack = (extra: Record<string, unknown> = {}, actionLayout?: unknown) => ({
  objects: [{ ...LEAD, ...(actionLayout ? { actionLayout } : {}) }],
  actions: [{ name: 'send_email', objectName: 'crm_lead', label: 'Send email', locations: ['record_header', 'list_toolbar'] }],
  ...extra,
});

const rules = (s: Record<string, unknown>) => validateObjectActionLayout(s).map((f) => `${f.rule} ${f.path}`);

describe('validateObjectActionLayout (objectstack#36366)', () => {
  it('passes pins of placed actions, own and stack-bound, and the $ built-ins', () => {
    expect(rules(stack({}, { record: { pinned: ['convert_lead', 'log_call'], more: ['send_email'] }, list: { pinned: ['$export', 'mass_assign'], more: ['$import', 'send_email'] } }))).toEqual([]);
    expect(rules(stack())).toEqual([]);
  });

  it('refuses a name no action of the object has, at error, naming it', () => {
    const [finding] = validateObjectActionLayout(stack({}, { record: { pinned: ['convert_lead', 'close_lead'] } }));
    expect(finding).toMatchObject({
      severity: 'error',
      rule: OBJECT_ACTION_LAYOUT_UNKNOWN,
      where: 'object "crm_lead"',
      path: 'objects[0].actionLayout.record.pinned[1]',
    });
    expect(finding.message).toContain('"close_lead"');
  });

  it('refuses an action of the other scope, or one placed nowhere, in either part', () => {
    expect(
      rules(stack({}, { list: { pinned: ['convert_lead'] }, record: { pinned: ['mass_assign'], more: ['headless'] } })),
    ).toEqual([
      `${OBJECT_ACTION_LAYOUT_NOT_PLACED} objects[0].actionLayout.list.pinned[0]`,
      `${OBJECT_ACTION_LAYOUT_NOT_PLACED} objects[0].actionLayout.record.pinned[0]`,
      `${OBJECT_ACTION_LAYOUT_NOT_PLACED} objects[0].actionLayout.record.more[0]`,
    ]);
  });

  it('refuses an unknown name in `more` too, naming the 「More」 menu', () => {
    const [finding] = validateObjectActionLayout(stack({}, { record: { pinned: [], more: ['gone_action'] } }));
    expect(finding).toMatchObject({ rule: OBJECT_ACTION_LAYOUT_UNKNOWN, path: 'objects[0].actionLayout.record.more[0]' });
    expect(finding.message).toBe(
      '"crm_lead" names "gone_action" for the record header\'s 「More」 menu, and "crm_lead" declares no action of that name, so it draws nothing',
    );
  });

  it('judges an extension against the object it extends, and skips one whose object the stack does not define', () => {
    const s = stack({
      objectExtensions: [
        { extend: 'crm_lead', actionLayout: { record: { pinned: ['send_email'], more: ['nope'] } } },
        { extend: 'sys_user', actionLayout: { record: { pinned: ['anything'] } } },
      ],
    });
    expect(rules(s)).toEqual([`${OBJECT_ACTION_LAYOUT_UNKNOWN} objectExtensions[0].actionLayout.record.more[0]`]);
  });

  it('is a gating rule on all three commands, CLI only with its reason, and its ids are on the barrel', () => {
    const rule = AUTHORING_RULES.find((r) => r.name === 'validateObjectActionLayout');
    expect(rule).toMatchObject({ tier: 'gating', surfaces: ['cli'] });
    expect(rule?.surfaceReason).toMatch(/snapshot/);
    expect(barrel.OBJECT_ACTION_LAYOUT_UNKNOWN).toBe('object-action-layout-unknown');
    expect(barrel.OBJECT_ACTION_LAYOUT_NOT_PLACED).toBe('object-action-layout-not-placed');
  });
});
