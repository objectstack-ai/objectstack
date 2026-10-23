// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_business_unit.kind` offers labelled options. Declared as the bare-string
 * shorthand, every label equalled its stored value, so the Business Unit form
 * showed `cost_center` as option text. The stored values are pinned beside the
 * labels: a label is display text, the value is what rows already hold.
 */

import { describe, it, expect } from 'vitest';
import { SysBusinessUnit } from './sys-business-unit.object';

type Option = { value: string; label: string };

describe('sys_business_unit.kind options', () => {
  const options = (SysBusinessUnit.fields.kind as { options: Option[] }).options;

  it('keeps the stored values', () => {
    expect(options.map((o) => o.value)).toEqual(['company', 'division', 'department', 'office', 'cost_center']);
  });

  it('gives every option a label that is not its machine value', () => {
    for (const o of options) {
      expect(o.label, o.value).not.toBe(o.value);
    }
  });
});
