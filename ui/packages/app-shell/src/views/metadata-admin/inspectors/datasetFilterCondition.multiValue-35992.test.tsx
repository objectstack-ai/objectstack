// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35992 — the Studio's FilterCondition editor (`FilterConditionField`
 * behind `datasetFilterCondition`: a dataset's scope and measure filters, a
 * field's `relatedListFilter`) learns a column's declared `multiple`.
 *
 * The evaluators behind it were measured on a live showcase backend
 * (`SqlDriver`, better-sqlite3), on `showcase_project.labels` (multiselect)
 * holding `["frontend","qa"]`, `["backend"]`, `["frontend","design"]`:
 *
 *   - the data door (`POST /data/:object/query`, a related list's read)
 *     refuses `{ labels: 'frontend' }` and `$in` with 400 and answers
 *     `$contains` with rows;
 *   - the dataset door (`POST /analytics/dataset/query`, a dataset's filter)
 *     answers the same `=` / `$in` with a count of 0, and `$contains` /
 *     `$notContains` / `$empty` with the right counts.
 *
 * So on a list-valued column the editor offers what the shared builder offers
 * it (`operatorsForField`): membership and the empty checks. A stored `$eq` /
 * `$in` there is not a row the builder can draw — it opens in Source rather
 * than as an `equals` row a sibling edit would re-commit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { conditionToGroup, type BuilderFieldDef } from './datasetFilterCondition';
import { buildFieldOptions, normalizeObject } from './useDatasetFields';

// One client for every render: the hook's effect keys on the client's
// identity, so a fresh object per call would re-run it without end.
const h = vi.hoisted(() => {
  const state = { doc: undefined as unknown };
  const client = { withPreviewDrafts: () => ({ get: async () => state.doc }) };
  return { state, client };
});

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => h.client,
}));

import { useObjectFields } from '../previews/useObjectFields';

afterEach(cleanup);

const OBJECT_DOC = {
  name: 'project',
  label: 'Project',
  fields: {
    owners: { type: 'user', label: 'Owners', multiple: true },
    accounts: { type: 'lookup', label: 'Accounts', reference: 'account', multiple: true },
    regions: { type: 'select', label: 'Regions', multiple: true, options: [{ value: 'emea', label: 'EMEA' }] },
    owner: { type: 'user', label: 'Owner' },
    region: { type: 'select', label: 'Region', options: [{ value: 'emea', label: 'EMEA' }] },
  },
};

const MULTI = ['owners', 'accounts', 'regions'];
const SINGLE = ['owner', 'region'];

describe('the field catalogs carry a column’s declared multiple (objectstack#35992)', () => {
  it('the dataset catalog marks exactly the multiple: true columns', () => {
    const options = buildFieldOptions(normalizeObject(OBJECT_DOC, 'project'), [], {});
    expect(options.filter((o) => o.multiple === true).map((o) => o.value)).toEqual(MULTI);
    expect(options.filter((o) => SINGLE.includes(o.value)).every((o) => !('multiple' in o))).toBe(true);
  });

  it('the object field hook marks exactly the multiple: true columns', async () => {
    h.state.doc = OBJECT_DOC;
    const hook = renderHook(() => useObjectFields('project'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const fields = hook.result.current.fields;
    expect(fields.filter((f) => f.multiple === true).map((f) => f.name)).toEqual(MULTI);
    expect(fields.filter((f) => SINGLE.includes(f.name)).every((f) => !('multiple' in f))).toBe(true);
  });
});

describe('a stored filter on a multiple: true column reads back as the builder can draw it', () => {
  const fields: BuilderFieldDef[] = Object.entries(OBJECT_DOC.fields).map(([value, f]) => ({
    value,
    type: f.type,
    ...('multiple' in f && f.multiple ? { multiple: true } : {}),
  }));

  it.each(MULTI)('%s: $contains / $notContains / $empty open as rows', (field) => {
    for (const [stored, operator] of [
      [{ [field]: { $contains: 'x' } }, 'contains'],
      [{ [field]: { $notContains: 'x' } }, 'not_contains'],
      [{ [field]: { $empty: true } }, 'is_empty'],
    ] as const) {
      const read = conditionToGroup(stored, fields);
      expect(read.representable, JSON.stringify(stored)).toBe(true);
      expect(read.group.conditions.map((c) => c.operator)).toEqual([operator]);
    }
  });

  it.each(MULTI)('%s: $eq / $in go to Source, not to an equals row', (field) => {
    for (const stored of [{ [field]: 'x' }, { [field]: { $in: ['x'] } }]) {
      expect(conditionToGroup(stored, fields).representable, JSON.stringify(stored)).toBe(false);
    }
  });

  it.each(SINGLE)('%s (single-value control): $eq / $in still open as rows', (field) => {
    for (const stored of [{ [field]: 'x' }, { [field]: { $in: ['x'] } }]) {
      expect(conditionToGroup(stored, fields).representable, JSON.stringify(stored)).toBe(true);
    }
  });
});
