// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_sharing_rule.recipient_type` and `access_level` offer labelled options,
 * and so does `sys_record_share`, which shares that vocabulary
 * (`recipient-vocabulary-consistency.test.ts` holds the two renderings equal).
 * Declared as the bare-string shorthand, every label equalled its stored value,
 * so the Sharing Rule form showed `unit_and_subordinates` as option text while
 * the help text under it already named the options by their labels. The stored
 * values are pinned beside the labels: a label is display text, the value is
 * what the evaluator matches on.
 */

import { describe, it, expect } from 'vitest';
import { SysSharingRule } from './objects/sys-sharing-rule.object.js';
import { SysRecordShare } from './objects/sys-record-share.object.js';

type Option = { value: string; label: string };
const optionsOf = (field: 'recipient_type' | 'access_level'): Option[] =>
  (SysSharingRule.fields[field] as { options: Option[] }).options;

describe('sys_sharing_rule select options', () => {
  it('recipient_type keeps its stored values', () => {
    expect(optionsOf('recipient_type').map((o) => o.value)).toEqual(
      ['user', 'team', 'business_unit', 'position', 'unit_and_subordinates', 'queue', 'field'],
    );
  });

  it('access_level keeps its stored values', () => {
    expect(optionsOf('access_level').map((o) => o.value)).toEqual(['read', 'edit']);
  });

  it.each(['recipient_type', 'access_level'] as const)('%s labels no option with its machine value', (field) => {
    for (const o of optionsOf(field)) {
      expect(o.label, o.value).not.toBe(o.value);
    }
  });

  it('the recipient_type help text names options the select actually shows', () => {
    const help = (SysSharingRule.fields.recipient_type as { description: string }).description;
    const labels = optionsOf('recipient_type').map((o) => o.label);
    expect(labels).toContain('Business unit and subordinates');
    expect(help).toContain('"Business unit and subordinates"');
    expect(labels).toContain('Field');
    expect(help).toContain('"Field"');
  });
});

describe('sys_record_share select options', () => {
  const optionsOf = (field: 'recipient_type' | 'access_level'): Option[] =>
    (SysRecordShare.fields[field] as { options: Option[] }).options;

  it('keeps the stored values', () => {
    expect(optionsOf('recipient_type').map((o) => o.value)).toEqual(['user', 'group', 'position', 'unit_and_subordinates']);
    expect(optionsOf('access_level').map((o) => o.value)).toEqual(['read', 'edit']);
  });

  it.each(['recipient_type', 'access_level'] as const)('%s labels no option with its machine value', (field) => {
    for (const o of optionsOf(field)) {
      expect(o.label, o.value).not.toBe(o.value);
    }
  });
});
