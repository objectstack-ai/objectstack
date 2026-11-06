// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A settings refusal for a value that misses its format reads in the console's
 * words (objectstack#30206). The settings service sends `code: 'invalid_format'`
 * with an English sentence for every reader; a Chinese administrator who typed
 * 「中国」 into 默认国家 read "Default country does not match the expected
 * format." The code is the machine half of the refusal, so the row's message is
 * the console's, naming the setting by the label the row draws. Every other
 * code keeps the server's sentence.
 *
 * Driven with the shipped `en` pack's templates, so a key renamed in the pack
 * turns this red rather than passing against a copy.
 */

import { describe, it, expect } from 'vitest';
import { en } from '@object-ui/i18n';
import { fieldWording, invalidFormatMessage, settingsFieldRefusals } from '../settingsFieldRefusals';
import type { Specifier } from '../types';

const VIEW = en.console.settingsView as Record<string, string>;

/** `t` over the `en` pack's `console.settingsView` templates. */
function t(key: string, options: Record<string, unknown> = {}): string {
  const leaf = key.replace('console.settingsView.', '');
  const template = VIEW[leaf];
  if (typeof template !== 'string') throw new Error(`no en template for ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''));
}

const COUNTRY: Specifier = {
  type: 'select',
  key: 'default_country',
  label: 'Default country',
  pattern: '^[A-Za-z]{2}$',
  valueDomain: 'iso_3166_alpha2',
  options: [
    { value: 'US', label: 'United States (US)' },
    { value: 'CN', label: 'China (CN)' },
  ],
};
const MODEL: Specifier = {
  type: 'text',
  key: 'gateway_model',
  label: 'Gateway model',
  description: 'Use provider/model.',
  pattern: '^[a-z]+/[a-z]+$',
};
const ACCOUNT: Specifier = { type: 'text', key: 'account_id', label: 'Account ID', pattern: '^[0-9a-f]+$' };

/** The 400 body's `error`, as `api.ts` parks it on `err.payload.error`. */
function refusal(fields: Array<{ field: string; code: string; message: string }>) {
  return { code: 'SETTINGS_VALIDATION', message: 'Settings are incomplete', details: { namespace: 'x', fields } };
}

const labels = {
  fieldLabel: (_key: string, fallback: string) => fallback,
  fieldHelp: (_key: string, fallback: string | undefined) => fallback,
};

describe('a format miss reads in the console words; every other refusal keeps the server sentence', () => {
  it('a picker says to choose from the list, by the row label', () => {
    expect(invalidFormatMessage(COUNTRY, { label: 'Default country' }, t)).toBe(
      'Choose a value for Default country from the list.',
    );
  });

  it('a typed field names the setting, and repeats the help line the refusal replaces', () => {
    expect(invalidFormatMessage(MODEL, { label: 'Gateway model', help: 'Use provider/model.' }, t)).toBe(
      'Gateway model is not in a valid format. Use provider/model.',
    );
    expect(invalidFormatMessage(ACCOUNT, { label: 'Account ID' }, t)).toBe('Account ID is not in a valid format.');
    expect(invalidFormatMessage(ACCOUNT, { label: 'Account ID', help: '  ' }, t)).toBe(
      'Account ID is not in a valid format.',
    );
  });

  it('maps each refused key in the order the server sent them, re-wording only invalid_format', () => {
    const rows = settingsFieldRefusals(
      refusal([
        { field: 'default_country', code: 'invalid_format', message: 'Default country does not match the expected format.' },
        { field: 'gateway_model', code: 'value_domain', message: 'Gateway model must be one of the listed models.' },
      ]),
      [COUNTRY, MODEL],
      fieldWording(labels),
      t,
    );
    expect(rows).toEqual([
      { field: 'default_country', message: 'Choose a value for Default country from the list.' },
      { field: 'gateway_model', message: 'Gateway model must be one of the listed models.' },
    ]);
  });

  it('names a key no specifier declares by the key itself', () => {
    const rows = settingsFieldRefusals(
      refusal([{ field: 'retired_key', code: 'invalid_format', message: 'Retired key does not match the expected format.' }]),
      [COUNTRY],
      fieldWording(labels),
      t,
    );
    expect(rows).toEqual([{ field: 'retired_key', message: 'retired_key is not in a valid format.' }]);
  });

  it('a refusal that is not field-scoped answers null, as before', () => {
    expect(settingsFieldRefusals({ code: 'INTERNAL_ERROR', message: 'boom' }, [COUNTRY], fieldWording(labels), t)).toBeNull();
    expect(settingsFieldRefusals(undefined, [COUNTRY], fieldWording(labels), t)).toBeNull();
  });
});
