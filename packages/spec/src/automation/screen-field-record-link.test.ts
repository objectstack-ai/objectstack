// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The read-only record-link screen field (`type: 'record_link'`), ruling B on
 * the screen-flow result screen.
 *
 * A screen field that SHOWS a record the run holds the id of and submits
 * nothing. The contract is a conditional refinement over the open `type` hint:
 * on this member `reference` and `defaultValue` are required, and the keys that
 * describe an input (`required`, `options`, `placeholder`, `min`, `max`) are
 * refused, each at its own key. Every other member is untouched.
 */

import { describe, expect, it } from 'vitest';

import {
  SCREEN_FIELD_RECORD_LINK_DEFAULT_VALUE_REQUIRED,
  SCREEN_FIELD_RECORD_LINK_REFERENCE_REQUIRED,
  SCREEN_FIELD_RECORD_LINK_REFUSED_KEYS,
  SCREEN_FIELD_RECORD_LINK_TYPE,
  ScreenConfigSchema,
  ScreenFieldConfigSchema,
  screenFieldRecordLinkRefusedKey,
} from './builtin-node-config.zod.js';

const LINK = {
  name: 'created_account',
  label: 'Account',
  type: 'record_link',
  reference: 'crm_account',
  defaultValue: { dialect: 'cel', source: 'account_id' },
} as const;

/** The issues a parse addressed to `key`, or `[]` when it parsed. */
function issuesAt(value: unknown, key: string) {
  const r = ScreenFieldConfigSchema.safeParse(value);
  return r.success ? [] : r.error.issues.filter((i) => i.path[0] === key);
}

describe("screen field `type: 'record_link'` — a read-only link to a record", () => {
  it('is spelled `record_link`, not the `record` the object field vocabulary already uses', () => {
    expect(SCREEN_FIELD_RECORD_LINK_TYPE).toBe('record_link');
  });

  it('accepts the declared shape — a CEL envelope id, a literal id, and the presentation keys', () => {
    const accepted = [
      LINK,
      { ...LINK, defaultValue: 'acc_0001' },
      { ...LINK, inlineHelpText: 'Opens the account the conversion created.' },
      { ...LINK, visibleWhen: 'create_opportunity == true' },
    ];
    for (const value of accepted) {
      const r = ScreenFieldConfigSchema.safeParse(value);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
    }
  });

  it('refuses a missing or blank `reference`, addressed to the key', () => {
    for (const reference of [undefined, '', '   ']) {
      const value = { ...LINK, reference };
      const issues = issuesAt(value, 'reference');
      expect(issues.map((i) => i.message), `reference: ${JSON.stringify(reference)}`)
        .toEqual([SCREEN_FIELD_RECORD_LINK_REFERENCE_REQUIRED]);
    }
  });

  it('refuses a missing or null `defaultValue`, addressed to the key', () => {
    const { defaultValue: _omit, ...withoutDefault } = LINK;
    for (const value of [withoutDefault, { ...LINK, defaultValue: null }]) {
      expect(issuesAt(value, 'defaultValue').map((i) => i.message))
        .toEqual([SCREEN_FIELD_RECORD_LINK_DEFAULT_VALUE_REQUIRED]);
    }
  });

  it('refuses every input key at that key — `required: false` included, since the key itself is the error', () => {
    expect([...SCREEN_FIELD_RECORD_LINK_REFUSED_KEYS]).toEqual(['required', 'options', 'placeholder', 'min', 'max']);
    const values: Record<(typeof SCREEN_FIELD_RECORD_LINK_REFUSED_KEYS)[number], unknown[]> = {
      required: [true, false],
      options: [[{ value: 'a', label: 'A' }]],
      placeholder: ['Pick one'],
      min: [0],
      max: [10],
    };
    for (const key of SCREEN_FIELD_RECORD_LINK_REFUSED_KEYS) {
      for (const v of values[key]) {
        const issues = issuesAt({ ...LINK, [key]: v }, key);
        expect(issues.map((i) => i.message), `${key}: ${JSON.stringify(v)}`)
          .toEqual([screenFieldRecordLinkRefusedKey(key)]);
        expect(issues[0]!.code).toBe('custom');
      }
    }
  });

  it('reports every broken rule of one field at once', () => {
    const r = ScreenFieldConfigSchema.safeParse({ name: 'x', type: 'record_link', required: true, placeholder: 'p' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['defaultValue', 'placeholder', 'reference', 'required']);
  });

  it('is refused through the screen node config too, at the field', () => {
    const r = ScreenConfigSchema.safeParse({ fields: [{ ...LINK, required: true }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.join('.') === 'fields.0.required')).toBe(true);
    expect(ScreenConfigSchema.safeParse({ fields: [LINK] }).success).toBe(true);
  });

  it('leaves every other widget hint alone — the input keys still parse on them', () => {
    for (const type of [undefined, 'text', 'number', 'select', 'record']) {
      const r = ScreenFieldConfigSchema.safeParse({
        name: 'x', ...(type ? { type } : {}), required: true, placeholder: 'p', min: 0, max: 1,
        options: [{ value: 'a', label: 'A' }],
      });
      expect(r.success, `type: ${String(type)}`).toBe(true);
    }
  });

  it('prints no tracker id at the author, and names the key it refuses', () => {
    const texts = [
      SCREEN_FIELD_RECORD_LINK_REFERENCE_REQUIRED,
      SCREEN_FIELD_RECORD_LINK_DEFAULT_VALUE_REQUIRED,
      ...SCREEN_FIELD_RECORD_LINK_REFUSED_KEYS.map(screenFieldRecordLinkRefusedKey),
    ];
    for (const text of texts) expect(text).not.toMatch(/#\d{3,5}\b/);
    expect(SCREEN_FIELD_RECORD_LINK_REFERENCE_REQUIRED).toContain('`reference`');
    expect(SCREEN_FIELD_RECORD_LINK_DEFAULT_VALUE_REQUIRED).toContain('`defaultValue`');
    expect(screenFieldRecordLinkRefusedKey('min')).toContain('`min`');
  });
});
