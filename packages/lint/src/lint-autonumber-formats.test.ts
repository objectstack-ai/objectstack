// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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
