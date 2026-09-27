// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DEFAULT_AUTONUMBER_FORMAT, resolveAutonumberFormat } from '@objectstack/spec/data';
import {
  lintAutonumberFormats,
  AUTONUMBER_UNKNOWN_FIELD,
  AUTONUMBER_OPTIONAL_FIELD,
  AUTONUMBER_SELF_REFERENCE,
  AUTONUMBER_LITERAL_TOKEN,
} from './lint-autonumber-formats.js';

describe('lintAutonumberFormats', () => {
  it('passes a date-only / fixed-prefix format with no {field} tokens', () => {
    const stack = {
      objects: [
        { name: 'audit', fields: { audit_no: { type: 'autonumber', autonumberFormat: 'AD{YYYYMMDD}{0000}' } } },
        { name: 'case', fields: { case_no: { type: 'autonumber', autonumberFormat: 'CASE-{0000}' } } },
      ],
    };
    expect(lintAutonumberFormats(stack)).toEqual([]);
  });

  it('passes when every {field} token is a required field on the object', () => {
    const stack = {
      objects: [
        {
          name: 'task',
          fields: {
            section: { type: 'text', required: true },
            island_zone: { type: 'text', required: true },
            task_no: { type: 'autonumber', autonumberFormat: '{section}{island_zone}{000}' },
          },
        },
      ],
    };
    expect(lintAutonumberFormats(stack)).toEqual([]);
  });

  it('errors when a {field} token names a non-existent field', () => {
    const stack = {
      objects: [
        { name: 'task', fields: { task_no: { type: 'autonumber', autonumberFormat: '{plan_no}{000}' } } },
      ],
    };
    const out = lintAutonumberFormats(stack);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].rule).toBe(AUTONUMBER_UNKNOWN_FIELD);
  });

  it('warns when a {field} token names an optional field', () => {
    const stack = {
      objects: [
        {
          name: 'task',
          fields: {
            plan_no: { type: 'text' }, // not required
            task_no: { type: 'autonumber', autonumberFormat: '{plan_no}{000}' },
          },
        },
      ],
    };
    const out = lintAutonumberFormats(stack);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warning');
    expect(out[0].rule).toBe(AUTONUMBER_OPTIONAL_FIELD);
  });

  it('errors when the format interpolates the autonumber field itself', () => {
    const stack = {
      objects: [
        { name: 'task', fields: { task_no: { type: 'autonumber', autonumberFormat: '{task_no}{000}' } } },
      ],
    };
    const out = lintAutonumberFormats(stack);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].rule).toBe(AUTONUMBER_SELF_REFERENCE);
  });

  it('warns on an unrecognized token that would render literally', () => {
    const stack = {
      objects: [
        { name: 'wo', fields: { wo_no: { type: 'autonumber', autonumberFormat: 'WO-{ YYYY }-{0000}' } } },
      ],
    };
    const out = lintAutonumberFormats(stack);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warning');
    expect(out[0].rule).toBe(AUTONUMBER_LITERAL_TOKEN);
    expect(out[0].message).toContain('{ YYYY }');
  });

  it('warns on a second sequence slot (only the first counts)', () => {
    const stack = {
      objects: [
        { name: 'wo', fields: { wo_no: { type: 'autonumber', autonumberFormat: '{0000}-{000}' } } },
      ],
    };
    const out = lintAutonumberFormats(stack);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe(AUTONUMBER_LITERAL_TOKEN);
    expect(out[0].message).toContain('second sequence slot');
  });

  it('does not warn on valid date/counter tokens', () => {
    const stack = {
      objects: [
        { name: 'audit', fields: { audit_no: { type: 'autonumber', autonumberFormat: 'AD{YYYYMMDD}{0000}' } } },
      ],
    };
    expect(lintAutonumberFormats(stack)).toEqual([]);
  });

  it('handles array-shaped fields and the `format` shorthand', () => {
    const stack = {
      objects: [
        {
          name: 'task',
          fields: [
            { name: 'plan_no', type: 'text', required: true },
            { name: 'task_no', type: 'autonumber', format: '{plan_no}{000}' },
          ],
        },
      ],
    };
    expect(lintAutonumberFormats(stack)).toEqual([]);
  });
});

/**
 * Which format the lint checks. The engine and the SQL driver both mint through
 * `resolveAutonumberFormat`: canonical `autonumberFormat`, then the `format`
 * shorthand, then the contract default — and a key holding anything but a
 * NON-EMPTY string counts as undeclared. A lint that answers "which format?"
 * any other way checks a format the runtime never renders, so it can pass a
 * field whose every create then throws.
 */
describe('lintAutonumberFormats — checks the format the runtime mints with', () => {
  const stackOf = (field: Record<string, unknown>) => ({
    objects: [
      {
        name: 'task',
        fields: [{ name: 'plan_no', type: 'text', required: true }, { name: 'task_no', type: 'autonumber', ...field }],
      },
    ],
  });

  it('an EMPTY autonumberFormat is undeclared: the `format` shorthand is linted, as the runtime mints it', () => {
    const out = lintAutonumberFormats(stackOf({ autonumberFormat: '', format: '{nope}{000}' }));
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe(AUTONUMBER_UNKNOWN_FIELD);
    expect(out[0].severity).toBe('error');
    expect(out[0].where).toContain('"{nope}{000}"');
  });

  it('a non-empty autonumberFormat wins over the `format` shorthand', () => {
    const out = lintAutonumberFormats(stackOf({ autonumberFormat: '{gone}{000}', format: '{plan_no}{000}' }));
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe(AUTONUMBER_UNKNOWN_FIELD);
    expect(out[0].message).toContain('{gone}');
  });

  it('the `format` shorthand is linted when autonumberFormat is absent', () => {
    const out = lintAutonumberFormats(stackOf({ format: '{nope}{000}' }));
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe(AUTONUMBER_UNKNOWN_FIELD);
  });

  it('with neither key declared, the contract default is linted — and draws no finding', () => {
    const declaredDefault = lintAutonumberFormats(stackOf({ autonumberFormat: DEFAULT_AUTONUMBER_FORMAT }));
    for (const undeclared of [{}, { autonumberFormat: '', format: '' }]) {
      expect(lintAutonumberFormats(stackOf(undeclared))).toEqual(declaredDefault);
    }
    expect(declaredDefault).toEqual([]);
  });

  it('for every spelling of the two keys, the findings equal those for the resolved format', () => {
    const values: unknown[] = [undefined, '', 7, 'A-{0000}', '{nope}{000}'];
    const diverged: string[] = [];
    for (const autonumberFormat of values) {
      for (const format of values) {
        const field: Record<string, unknown> = {};
        if (autonumberFormat !== undefined) field.autonumberFormat = autonumberFormat;
        if (format !== undefined) field.format = format;
        const asWritten = lintAutonumberFormats(stackOf(field));
        const asMinted = lintAutonumberFormats(stackOf({ autonumberFormat: resolveAutonumberFormat(field) }));
        if (JSON.stringify(asWritten) !== JSON.stringify(asMinted)) diverged.push(JSON.stringify(field));
      }
    }
    expect(diverged).toEqual([]);
  });
});
