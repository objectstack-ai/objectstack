// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `type: 'record_link'` screen field takes NO value on resume (ruling B on
 * the screen-flow result screen).
 *
 * The field shows a record — the id its `defaultValue` was served with — as a
 * link to the record's page. Nothing on the screen changes it, so a resume that
 * carries any value under its name is refused with `invalid_value`, ⛔ never
 * dropped and ⛔ never bound. And because no caller can answer a display field,
 * the headless verdict never counts one as supplied.
 */

import { describe, expect, it } from 'vitest';

import type { ScreenFieldSpec } from '@objectstack/spec/contracts';

import { judgeHeadlessScreen, validateScreenInputs } from './screen-input-contract.js';

const ALWAYS_VISIBLE = () => true;

const link: ScreenFieldSpec = { name: 'created_account', label: 'Account', type: 'record_link', reference: 'crm_account', defaultValue: 'acc_1' };
const note: ScreenFieldSpec = { name: 'note', label: 'Note', type: 'text' };

describe("validateScreenInputs — a `type: 'record_link'` field takes no value", () => {
  it('passes a resume that leaves the field out', () => {
    expect(validateScreenInputs([link, note], { note: 'done' }, ALWAYS_VISIBLE)).toEqual([]);
    expect(validateScreenInputs([link], {}, ALWAYS_VISIBLE)).toEqual([]);
  });

  it('refuses ANY value under its name with `invalid_value` — the id it shows, another id, empty and null alike', () => {
    for (const value of ['acc_1', 'acc_2', '', null, { id: 'acc_1' }, 0, false]) {
      const issues = validateScreenInputs([link, note], { created_account: value, note: 'x' }, ALWAYS_VISIBLE);
      expect(issues, JSON.stringify(value)).toEqual([{
        field: 'created_account',
        code: 'invalid_value',
        message: 'Screen field "created_account" shows a record and takes no value — leave it out of the resume',
      }]);
    }
  });

  it('refuses it hidden too — visibility decides what a user was asked for, and this field asks nothing', () => {
    const hidden: ScreenFieldSpec = { ...link, visibleWhen: 'false' };
    for (const visibility of [() => false, () => undefined]) {
      const issues = validateScreenInputs([hidden], { created_account: 'acc_1' }, visibility);
      expect(issues.map((i) => i.code)).toEqual(['invalid_value']);
    }
  });

  it('reads the member exactly, as the value domains are read — another type with the same value is untouched', () => {
    for (const type of ['text', 'lookup', 'record', 'Record_Link']) {
      const field: ScreenFieldSpec = { ...link, type };
      expect(validateScreenInputs([field], { created_account: 'acc_1' }, ALWAYS_VISIBLE), type).toEqual([]);
    }
  });
});

describe("judgeHeadlessScreen — a caller cannot answer a `type: 'record_link'` field", () => {
  it('does not count a param that shares the field\'s name as supplied, so the screen still pauses', () => {
    const verdict = judgeHeadlessScreen(
      [link],
      new Map<string, unknown>([['created_account', 'acc_1']]),
      { params: { created_account: 'acc_1' }, callerParamKeys: ['created_account'] },
    );
    expect(verdict).toEqual({ satisfied: false, supplied: [], missing: [] });
  });

  it('positive control: the same param under an input field\'s name is supplied', () => {
    const asText: ScreenFieldSpec = { ...link, type: 'text', defaultValue: undefined };
    const verdict = judgeHeadlessScreen(
      [asText],
      new Map<string, unknown>([['created_account', 'acc_1']]),
      { params: { created_account: 'acc_1' }, callerParamKeys: ['created_account'] },
    );
    expect(verdict).toEqual({ satisfied: true, supplied: ['created_account'], missing: [] });
  });
});
