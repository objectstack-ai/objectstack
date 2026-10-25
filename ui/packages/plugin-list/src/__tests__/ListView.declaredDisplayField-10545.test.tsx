/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10545 — the filter candidate reads a lookup's display field in the
 * spelling `FieldSchema` declares, and only in it.
 *
 * Once the object definition loads, `ListView` builds its filter and sort
 * candidates from `objectDef.fields`. That branch used to read
 * `display_field || reference_field` and `id_field`, spellings `FieldSchema`
 * refuses, and never `displayField`, the one it declares. So a spec-compliant
 * lookup's display field never reached the filter's value picker. The ruling
 * (triage 5831112408): read the declared `displayField`, with no fallback to
 * the refused spellings, the way `plugin-grid`'s copy set reads it.
 *
 * Every render here lets the definition load: the columns-only branch before
 * it is objectui#7531's pin, and a test that never loaded the definition would
 * read that branch and pass whatever this one does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { FieldSchema } from '@objectstack/spec/data';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

/** One filter candidate as ListView builds it. */
type Candidate = {
  value: string;
  label: string;
  type: string;
  options?: unknown;
  referenceTo?: string;
  displayField?: string;
  idField?: string;
};

// What ListView hands the filter builder: the candidate list itself, rather
// than whichever value picker the builder happens to draw from it.
const captured = vi.hoisted(() => ({ fields: [] as Candidate[][] }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...actual,
    FilterBuilder: (props: { fields: Candidate[] }) => {
      captured.fields.push(props.fields);
      return null;
    },
  };
});

import { ListView } from '../ListView';

/** The lookup def with no display spelling at all. */
const BARE_LOOKUP = { type: 'lookup', label: 'Account', reference: 'crm_account' } as const;

/** The spec-compliant def: the declared spelling, and no snake twin. */
const DECLARED_LOOKUP = { ...BARE_LOOKUP, displayField: 'full_name' } as const;

/** The spellings the candidate used to read, each refused by `FieldSchema`. */
const REFUSED_SPELLINGS = {
  display_field: 'full_name',
  reference_field: 'full_name',
  id_field: 'code',
} as const;

function makeDataSource(accountDef: Record<string, unknown>) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'crm_contact',
      fields: {
        account_id: accountDef,
        name: { type: 'text', label: 'Name' },
      },
    }),
  };
}

/** Render, open the filter builder, and wait for the DEFINITION branch. */
async function lookupCandidateFor(accountDef: Record<string, unknown>): Promise<Candidate> {
  captured.fields.length = 0;
  const dataSource = makeDataSource(accountDef);
  const schema = {
    type: 'list-view',
    objectName: 'crm_contact',
    viewType: 'grid',
    columns: [{ field: 'account_id', label: 'Account', type: 'lookup' }, { field: 'name', label: 'Name' }],
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
  await screen.findByText('Filter Records');
  // `referenceTo` is read off the definition only (objectui#7531), so seeing
  // it proves the candidate below came from the `objectDef.fields` branch.
  await waitFor(() => {
    const latest = captured.fields[captured.fields.length - 1];
    expect(latest?.find((f) => f.value === 'account_id')?.referenceTo).toBe('crm_account');
  });
  const latest = captured.fields[captured.fields.length - 1];
  return latest.find((f) => f.value === 'account_id') as Candidate;
}

afterEach(() => {
  cleanup();
  captured.fields.length = 0;
});

describe('objectui#10545 — the definition-branch candidate reads the declared `displayField`', () => {
  it('the spec accepts the declared def and refuses every retired spelling (lit control: the bare def parses)', () => {
    expect(FieldSchema.safeParse({ name: 'account_id', ...BARE_LOOKUP }).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'account_id', ...DECLARED_LOOKUP }).success).toBe(true);
    for (const [key, value] of Object.entries({ ...REFUSED_SPELLINGS, idField: 'code' })) {
      const result = FieldSchema.safeParse({ name: 'account_id', ...BARE_LOOKUP, [key]: value });
      expect(result.success, key).toBe(false);
      const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue && 'keys' in issue ? issue.keys : [], key).toEqual([key]);
    }
  });

  it('a lookup declaring `displayField` hands that display field to the candidate', async () => {
    const candidate = await lookupCandidateFor(DECLARED_LOOKUP);
    expect(candidate.displayField).toBe('full_name');
  });

  it('a def carrying only `display_field` no longer sets it', async () => {
    const candidate = await lookupCandidateFor({ ...BARE_LOOKUP, display_field: REFUSED_SPELLINGS.display_field });
    expect(candidate.displayField).toBeUndefined();
  });

  it('a def carrying only `reference_field` no longer sets it', async () => {
    const candidate = await lookupCandidateFor({ ...BARE_LOOKUP, reference_field: REFUSED_SPELLINGS.reference_field });
    expect(candidate.displayField).toBeUndefined();
  });

  it('no id column is read off the def: `id_field` no longer reaches the candidate', async () => {
    const candidate = await lookupCandidateFor({ ...DECLARED_LOOKUP, id_field: REFUSED_SPELLINGS.id_field });
    expect(candidate.idField).toBeUndefined();
    expect(candidate.displayField).toBe('full_name');
  });
});
