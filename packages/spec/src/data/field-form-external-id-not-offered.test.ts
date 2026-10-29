// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26674 — the field form must not OFFER `field.externalId`.
 *
 * The key is graded `dead` in `liveness/field.json`: no upsert, import or seed
 * matches on it. The form's row still read "Mark as external ID for upsert
 * operations", so a Studio author who switched it on for an import key got
 * duplicates on re-import and an `os lint` warning on the flag the form had
 * offered. The row is gone; the key is NOT retired — `FieldSchema` keeps
 * parsing it, so a stored `externalId: true` stays valid metadata and every
 * Studio writer carries it through untouched.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { fieldForm } from './field.form';
import { FieldSchema } from './field.zod';

const HERE = dirname(fileURLToPath(import.meta.url));

type FormEntry = { field?: string; helpText?: string; fields?: FormEntry[] };

/** Every entry of the form, nested composite / list members included. */
function allEntries(): FormEntry[] {
  const out: FormEntry[] = [];
  const walk = (entries: FormEntry[] | undefined) => {
    for (const e of entries ?? []) {
      out.push(e);
      walk(e.fields);
    }
  };
  for (const section of (fieldForm as { sections: { fields?: FormEntry[] }[] }).sections) {
    walk(section.fields);
  }
  return out;
}

describe('field form: externalId is not offered', () => {
  it('declares no externalId row at any depth', () => {
    const entries = allEntries();
    // Positive control: the walk does reach the advanced section's rows.
    expect(entries.some((e) => e.field === 'storage')).toBe(true);
    expect(entries.filter((e) => e.field === 'externalId')).toEqual([]);
  });

  it('no help text still calls a field flag an upsert key', () => {
    const offenders = allEntries().filter((e) => /external id for upsert/i.test(e.helpText ?? ''));
    expect(offenders).toEqual([]);
  });

  it('the key itself is kept: FieldSchema still parses an authored externalId', () => {
    const parsed = FieldSchema.safeParse({ type: 'text', label: 'Code', externalId: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.externalId).toBe(true);
  });

  it('the liveness row still grades field.externalId dead', () => {
    const liveness = JSON.parse(readFileSync(resolve(HERE, '../../liveness/field.json'), 'utf8')) as {
      props: Record<string, { status: string }>;
    };
    expect(liveness.props.externalId?.status).toBe('dead');
  });
});
