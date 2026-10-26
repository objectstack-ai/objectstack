/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeFieldReferenceKeys,
  normalizeSchemaReferenceKeys,
} from '../reference-keys';

describe('normalizeFieldReferenceKeys', () => {
  // objectui#11070 round 4: `reference` is the only spelling ObjectUI writes or
  // reads, so this pass FOLDS a foreign spelling onto it and never stamps
  // `reference_to`. Two pins here used to assert that stamp (on a
  // `reference` def and on a `referenceTo` def) and now assert its absence;
  // the idempotence and map / array pins below flipped for the same reason.
  it('does NOT stamp reference_to onto a def that carries the spec `reference` key', () => {
    // Exactly what the showcase backend serves for showcase_project.account.
    const field = { type: 'lookup', reference: 'showcase_account' } as any;
    normalizeFieldReferenceKeys(field);
    expect(field.reference).toBe('showcase_account');
    expect('reference_to' in field).toBe(false);
  });

  it('folds a foreign reference_to onto `reference`, leaving the foreign key where it was', () => {
    const field = { type: 'master_detail', reference_to: 'showcase_project' } as any;
    normalizeFieldReferenceKeys(field);
    expect(field.reference).toBe('showcase_project');
    // The leave arm: nothing here drops a key.
    expect(field.reference_to).toBe('showcase_project');
  });

  it('folds legacy camelCase referenceTo onto `reference`, and stamps no reference_to', () => {
    const field = { type: 'lookup', referenceTo: 'accounts' } as any;
    normalizeFieldReferenceKeys(field);
    expect(field.reference).toBe('accounts');
    expect('reference_to' in field).toBe(false);
  });

  it('never overwrites a `reference` that is already set', () => {
    // Divergent keys are broken metadata. The producer's `reference` stands —
    // it is the one spelling every reader reads — and the foreign value stays
    // on the def unread.
    const field = { reference_to: 'a', reference: 'b' } as any;
    normalizeFieldReferenceKeys(field);
    expect(field.reference_to).toBe('a');
    expect(field.reference).toBe('b');
  });

  it('is a no-op for non-relational fields, empty targets, and non-objects', () => {
    const plain = { type: 'text' } as any;
    normalizeFieldReferenceKeys(plain);
    expect('reference_to' in plain).toBe(false);
    expect('reference' in plain).toBe(false);

    const empty = { type: 'lookup', reference: '' } as any;
    normalizeFieldReferenceKeys(empty);
    expect('reference_to' in empty).toBe(false);

    expect(normalizeFieldReferenceKeys(null)).toBeNull();
    expect(normalizeFieldReferenceKeys('lookup' as any)).toBe('lookup');
  });

  it('is idempotent', () => {
    const field = { type: 'user', reference: 'sys_user' } as any;
    normalizeFieldReferenceKeys(normalizeFieldReferenceKeys(field));
    expect(field).toEqual({ type: 'user', reference: 'sys_user' });

    const legacy: Record<string, unknown> = { type: 'lookup', reference_to: 'accounts' };
    normalizeFieldReferenceKeys(normalizeFieldReferenceKeys(legacy));
    expect(legacy).toEqual({ type: 'lookup', reference_to: 'accounts', reference: 'accounts' });
  });
});

describe('normalizeSchemaReferenceKeys', () => {
  it('normalizes every field of a map-shaped schema in place', () => {
    const schema = {
      name: 'showcase_project',
      fields: {
        name: { type: 'text' },
        account: { type: 'lookup', reference: 'showcase_account' },
        team_members: { type: 'user', reference: 'sys_user', multiple: true },
      },
    } as any;
    const out = normalizeSchemaReferenceKeys(schema);
    expect(out).toBe(schema); // mutates the cached object, not a copy
    expect(schema.fields.account).toEqual({ type: 'lookup', reference: 'showcase_account' });
    expect(schema.fields.team_members).toEqual({ type: 'user', reference: 'sys_user', multiple: true });
    expect('reference_to' in schema.fields.name).toBe(false);
  });

  it('normalizes array-shaped field containers', () => {
    const schema = {
      fields: [
        { name: 'project', type: 'master_detail', reference_to: 'showcase_project' },
        { name: 'title', type: 'text' },
      ],
    } as any;
    normalizeSchemaReferenceKeys(schema);
    expect(schema.fields[0].reference).toBe('showcase_project');
    expect('reference' in schema.fields[1]).toBe(false);
  });

  it('tolerates schemas without fields and non-object input', () => {
    expect(normalizeSchemaReferenceKeys(null)).toBeNull();
    expect(normalizeSchemaReferenceKeys({ name: 'x' } as any)).toEqual({ name: 'x' });
    expect(normalizeSchemaReferenceKeys({ fields: 'nope' } as any)).toEqual({ fields: 'nope' });
  });
});
