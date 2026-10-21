// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25013 — `sys_metadata_audit.lock_state` declares a column that holds the
 * value its writer stores.
 *
 * The writer (`metadata-protocol` `protocol.ts`, `lock_state: entry.lockState
 * ?? 'none'`) stores a `MetadataLock` as spelled — `no-overlay`, `no-delete`.
 * The column used to be `Field.select([...])`, whose shorthand stripped the
 * hyphen and declared `nooverlay` / `nodelete`, values no row ever held. A
 * select option value is a system identifier, which holds no hyphen, so the
 * column is text, and the closed set stays with `MetadataLockSchema`.
 */
import { describe, expect, it } from 'vitest';
import { ObjectSchema, SelectOptionSchema } from '@objectstack/spec/data';
import { MetadataLockSchema } from '@objectstack/spec/kernel';
import { SysMetadataAuditObject } from './sys-metadata-audit.object.js';

describe('sys_metadata_audit.lock_state (#25013)', () => {
  const field = SysMetadataAuditObject.fields.lock_state as Record<string, unknown>;

  it('is a text column with no option list of its own, as wide as the select column was', () => {
    expect(field.type).toBe('text');
    expect(field).not.toHaveProperty('options');
    // The `varchar(255)` a select column is created as: an existing database
    // reports no drift (no `maxLength` would read as varchar → text).
    expect(field.maxLength).toBe(255);
    expect(field.readonly).toBe(true);
  });

  it('the writer stores values a select option could not declare — which is why it is not a select', () => {
    const undeclarable = MetadataLockSchema.options.filter(
      (lock) => !SelectOptionSchema.safeParse({ label: lock, value: lock }).success,
    );
    expect(undeclarable).toEqual(['no-overlay', 'no-delete']);
  });

  it('the object still parses as a whole', () => {
    expect(ObjectSchema.safeParse(SysMetadataAuditObject).success).toBe(true);
  });
});
