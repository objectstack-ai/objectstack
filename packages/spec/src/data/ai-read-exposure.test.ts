// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema, ObjectCapabilities } from './object.zod';
import { aiReadExposureRefusal, isAiReadExposed } from './ai-read-exposure';
import { STORED_METADATA_BODY_OBJECTS } from '../kernel/stored-metadata-body-objects';

/**
 * [ruling A on the read half of #32442] `enable.aiReadable` — the per-object,
 * read-only AI exposure of a system object. Four rules, each pinned here: the
 * key is accepted on a `sys_*` object; refused on any other object; refused on
 * the stored-metadata family, which its one reading judges before the key is
 * read; and it has no write arm.
 */

function objectWith(name: string, enable: Record<string, unknown>) {
  return { name, label: 'Probe', fields: { title: { type: 'text', label: 'Title' } }, enable };
}

function aiReadableIssues(result: ReturnType<typeof ObjectSchema.safeParse>) {
  return result.success
    ? []
    : result.error.issues.filter((i) => i.path.join('.') === 'enable.aiReadable');
}

describe('enable.aiReadable — accepted on a system object', () => {
  it('parses on a sys_* object, and its one reading answers true for true only', () => {
    const declared = ObjectSchema.safeParse(objectWith('sys_approval_request', { aiReadable: true }));
    expect(declared.success).toBe(true);
    expect(declared.success ? declared.data.enable?.aiReadable : undefined).toBe(true);
    expect(isAiReadExposed(declared.success ? declared.data : undefined)).toBe(true);

    // `false` on a system object restates the default and is accepted.
    const closed = ObjectSchema.safeParse(objectWith('sys_approval_request', { aiReadable: false }));
    expect(closed.success).toBe(true);
    expect(isAiReadExposed(closed.success ? closed.data : undefined)).toBe(false);

    // Absent: nothing declared, nothing opened, no default written.
    const absent = ObjectSchema.safeParse(objectWith('sys_approval_request', {}));
    expect(absent.success).toBe(true);
    expect(absent.success ? absent.data.enable?.aiReadable : 'parse failed').toBeUndefined();
    expect(isAiReadExposed(absent.success ? absent.data : undefined)).toBe(false);
  });
});

describe('enable.aiReadable — refused on a non-system object', () => {
  it.each([true, false])('refuses aiReadable: %s on a business object, located at the key', (value) => {
    const result = ObjectSchema.safeParse(objectWith('crm_account', { aiReadable: value }));
    expect(result.success).toBe(false);
    const issues = aiReadableIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('custom');
  });

  it('its one reading never answers true off a system object, even on input no parse judged', () => {
    expect(isAiReadExposed({ name: 'crm_account', enable: { aiReadable: true } })).toBe(false);
  });
});

describe('enable.aiReadable — refused on the stored-metadata family, before the key is read', () => {
  const family = [...STORED_METADATA_BODY_OBJECTS];

  it('reads the family from its one list', () => {
    expect(family.length).toBeGreaterThan(0);
    expect(family).toContain('sys_metadata');
  });

  it.each(family)('refuses aiReadable on %s, true or false', (name) => {
    for (const value of [true, false]) {
      const result = ObjectSchema.safeParse(objectWith(name, { aiReadable: value }));
      expect(result.success).toBe(false);
      const issues = aiReadableIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe('custom');
    }
  });

  it.each(family)('its one reading answers false on %s without reading the key', (name) => {
    let reads = 0;
    const enable = {
      get aiReadable() {
        reads += 1;
        return true;
      },
    };
    expect(isAiReadExposed({ name, enable })).toBe(false);
    expect(reads).toBe(0);
    // Control leg: the same probe on a system object outside the family is read.
    expect(isAiReadExposed({ name: 'sys_approval_request', enable })).toBe(true);
    expect(reads).toBe(1);
  });

  it('the refusal of a family member is not the business-object refusal', () => {
    const family0 = aiReadExposureRefusal(family[0], { aiReadable: true });
    const business = aiReadExposureRefusal('crm_account', { aiReadable: true });
    expect(family0).toBeDefined();
    expect(business).toBeDefined();
    expect(family0?.message).not.toBe(business?.message);
  });
});

describe('enable.aiReadable — no write arm', () => {
  it('the enable block declares exactly one AI key, and it is the read one', () => {
    const aiKeys = Object.keys(ObjectCapabilities.shape).filter((k) => /^(ai|mcp)/i.test(k));
    expect(aiKeys).toEqual(['aiReadable']);
  });

  it.each(['aiWritable', 'aiWrite', 'aiEditable', 'aiExposed'])('refuses enable.%s as an undeclared key', (key) => {
    const result = ObjectCapabilities.safeParse({ [key]: true });
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('takes a boolean only: no value names a write scope', () => {
    for (const value of ['write', 'read_write', 'all', 'true', 1]) {
      const result = ObjectCapabilities.safeParse({ aiReadable: value });
      expect(result.success).toBe(false);
      expect(result.success ? undefined : result.error.issues[0]?.code).toBe('invalid_type');
    }
  });

  it('its one reading opens on the boolean true only', () => {
    for (const value of ['true', 1, {}, 'read']) {
      expect(isAiReadExposed({ name: 'sys_approval_request', enable: { aiReadable: value } })).toBe(false);
    }
    expect(isAiReadExposed(undefined)).toBe(false);
    expect(isAiReadExposed({ name: 'sys_approval_request' })).toBe(false);
  });
});
