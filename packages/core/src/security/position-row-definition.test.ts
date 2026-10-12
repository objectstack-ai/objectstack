// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D10] The pin of `positionDefinitionFromRow` — the mapping the
 * upgrade ceremony applies to turn a Setup-created `sys_position` row into the
 * definition it saves through the metadata door.
 *
 * The expected bodies are the outputs the module doc states, written out by
 * hand: this package cannot import the security plugin's copy, so the
 * byte-for-behaviour comparison with it was a one-time measurement, recorded on
 * the pull request that added this file.
 */

import { describe, expect, it } from 'vitest';
import { PositionSchema } from '@objectstack/spec/identity';
import { positionDefinitionFromRow } from './position-row-definition.js';

/** A row as `sys_position` stores it, its row state riding along. */
const storedRow = {
  id: 'pos_01',
  name: 'regional_manager',
  label: 'Regional Manager',
  description: 'Runs one sales region',
  delegatable: 1,
  active: false,
  is_default: true,
  managed_by: 'admin',
  organization_id: 'org_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('positionDefinitionFromRow', () => {
  it('answers the four definition keys the row has columns for, in order', () => {
    const body = positionDefinitionFromRow(storedRow);
    expect(body).toStrictEqual({
      name: 'regional_manager',
      label: 'Regional Manager',
      description: 'Runs one sales region',
      delegatable: true,
    });
    expect(Object.keys(body)).toEqual(['name', 'label', 'description', 'delegatable']);
  });

  it('every key it emits is one PositionSchema declares, and a well-formed row answers a body the schema accepts', () => {
    const declared = Object.keys((PositionSchema as unknown as { shape: Record<string, unknown> }).shape);
    const body = positionDefinitionFromRow(storedRow);
    for (const key of Object.keys(body)) expect(declared, key).toContain(key);
    const parsed = PositionSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('never carries a row state, provenance or identity column', () => {
    const body = positionDefinitionFromRow(storedRow);
    for (const column of ['id', 'active', 'is_default', 'managed_by', 'organization_id', 'created_at', 'updated_at']) {
      expect(body, column).not.toHaveProperty(column);
    }
  });

  it('the label falls back to the name unless it is a non-empty string', () => {
    for (const label of [undefined, null, '', 42]) {
      expect(positionDefinitionFromRow({ name: 'auditor', label }).label, String(label)).toBe('auditor');
    }
    expect(positionDefinitionFromRow({ name: 'auditor', label: 'Auditor' }).label).toBe('Auditor');
  });

  it('the description travels only as a non-empty string — never as null', () => {
    for (const description of [undefined, null, '', 7]) {
      expect(positionDefinitionFromRow({ name: 'auditor', description }), String(description)).not.toHaveProperty('description');
    }
    expect(positionDefinitionFromRow({ name: 'auditor', description: 'Reads all' }).description).toBe('Reads all');
  });

  it('delegatable is always present: true for true, 1, "1" and "true", false for everything else', () => {
    for (const stored of [true, 1, '1', 'true']) {
      expect(positionDefinitionFromRow({ name: 'p', delegatable: stored }).delegatable, String(stored)).toBe(true);
    }
    for (const stored of [undefined, null, false, 0, '0', 'false', '', 'TRUE', 'yes', 2]) {
      expect(positionDefinitionFromRow({ name: 'p', delegatable: stored }).delegatable, String(stored)).toBe(false);
    }
  });

  it('two rows of one name answer equal serializations exactly when their definitions agree', () => {
    const serialized = (row: Parameters<typeof positionDefinitionFromRow>[0]) => JSON.stringify(positionDefinitionFromRow(row));
    // Row state and organization differ; the definition does not.
    expect(serialized({ ...storedRow, id: 'pos_02', organization_id: 'org_2', active: true, delegatable: 'true' }))
      .toBe(serialized(storedRow));
    // An empty description is the same definition as a null one.
    expect(serialized({ name: 'p', label: 'P', description: '' })).toBe(serialized({ name: 'p', label: 'P', description: null }));
    // A different label is a different definition.
    expect(serialized({ ...storedRow, label: 'Area Manager' })).not.toBe(serialized(storedRow));
  });

  it('does not judge the name: a name the metadata door refuses still answers a body', () => {
    expect(positionDefinitionFromRow({ name: 'Regional Manager' })).toStrictEqual({
      name: 'Regional Manager',
      label: 'Regional Manager',
      delegatable: false,
    });
  });

  it('is pure: the row is read, never written, and the same row answers the same body', () => {
    const row = Object.freeze({ ...storedRow });
    const first = positionDefinitionFromRow(row);
    expect(positionDefinitionFromRow(row)).toStrictEqual(first);
    expect(row).toStrictEqual(storedRow);
  });
});
