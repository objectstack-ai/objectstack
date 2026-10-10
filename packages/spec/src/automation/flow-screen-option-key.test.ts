// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A screen field's option is addressed as text by its value (#22507) — the
 * key its label translation sits under — so two options of one field whose
 * values read the same as text are refused at parse, at the second of the
 * pair, with the remedy.
 */

import { describe, expect, it } from 'vitest';
import { flowScreenFieldOptionKey } from './flow-screen-option-key';
import { SCREEN_FIELD_OPTION_VALUE_COLLISION, ScreenFieldConfigSchema } from './builtin-node-config.zod';
import { FlowSchema } from './flow.zod';

const field = (options: Array<{ value?: unknown; label: string }>) => ({ name: 'tier', label: 'Tier', type: 'select', options });

const screenFlow = (options: Array<{ value?: unknown; label: string }>) => ({
  name: 'intake',
  label: 'Intake',
  type: 'screen',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'details', type: 'screen', label: 'Details', config: { title: 'Details', fields: [field(options)] } },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'details' },
    { id: 'e2', source: 'details', target: 'done' },
  ],
});

describe('flowScreenFieldOptionKey — an option addressed as text', () => {
  it('is the value coerced to a string, the console select\'s own identity for the option', () => {
    expect(flowScreenFieldOptionKey('hq')).toBe('hq');
    expect(flowScreenFieldOptionKey(1)).toBe('1');
    expect(flowScreenFieldOptionKey(true)).toBe('true');
    expect(flowScreenFieldOptionKey(null)).toBe('null');
  });
});

describe('ScreenFieldConfigSchema — option values must stay distinct as text', () => {
  it('refuses `1` beside `"1"` at the second option\'s value, naming both and the remedy', () => {
    const result = ScreenFieldConfigSchema.safeParse(field([
      { value: 'gold', label: 'Gold' },
      { value: 1, label: 'One' },
      { value: '1', label: 'One again' },
    ]));
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['options', 2, 'value']);
    expect(issues[0]!.message.startsWith(SCREEN_FIELD_OPTION_VALUE_COLLISION)).toBe(true);
    // The pair is named by position and by the values as written, and the
    // remedy closes the message.
    expect(issues[0]!.message).toContain('Option [2] (value "1")');
    expect(issues[0]!.message).toContain('option [1] (value 1)');
    expect(issues[0]!.message).toContain('Give each option a value that stays distinct as text');
  });

  it('refuses a boolean beside its string spelling, and a repeated value', () => {
    const boolPair = ScreenFieldConfigSchema.safeParse(field([{ value: true, label: 'Yes' }, { value: 'true', label: 'Yes!' }]));
    expect(boolPair.success).toBe(false);
    expect(boolPair.error!.issues[0]!.path).toEqual(['options', 1, 'value']);

    const repeated = ScreenFieldConfigSchema.safeParse(field([
      { value: 'a', label: 'A' }, { value: 'a', label: 'A2' }, { value: 'a', label: 'A3' },
    ]));
    expect(repeated.success).toBe(false);
    // Each later duplicate is located, and each names the FIRST holder.
    expect(repeated.error!.issues.map((i) => i.path)).toEqual([['options', 1, 'value'], ['options', 2, 'value']]);
    expect(repeated.error!.issues.every((i) => i.message.includes('option [0]'))).toBe(true);
  });

  it('control — distinct values of any type parse, so the refusal is the collision and nothing else', () => {
    for (const options of [
      [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }],
      [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: '3', label: 'Three' }],
      [{ value: true, label: 'Yes' }, { value: false, label: 'No' }],
    ]) {
      const result = ScreenFieldConfigSchema.safeParse(field(options));
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it('reaches the flow door: `FlowSchema` refuses the colliding field, located at the option', () => {
    const refused = FlowSchema.safeParse(screenFlow([{ value: 1, label: 'One' }, { value: '1', label: 'One again' }]));
    expect(refused.success).toBe(false);
    const issue = refused.error!.issues.find((i) => i.message.includes(SCREEN_FIELD_OPTION_VALUE_COLLISION));
    expect(issue, JSON.stringify(refused.error!.issues)).toBeDefined();
    expect(issue!.path.join('.')).toContain('options');

    // Control: the same flow with distinct values parses.
    const control = FlowSchema.safeParse(screenFlow([{ value: 1, label: 'One' }, { value: '2', label: 'Two' }]));
    expect(control.success, JSON.stringify(control.error?.issues)).toBe(true);
  });
});
