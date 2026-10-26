/**
 * Regression: LookupCellRenderer must resolve a bare foreign-key id to a
 * display name when the field metadata carries the ObjectStack `reference`
 * key (as produced by `Field.lookup('...')` in @objectstack/spec).
 *
 * Real-world symptom (framework app-showcase): inline-edit a lookup cell, pick
 * a record, click another row → the cell showed a muted "—" forever because
 * the just-picked opaque id could not be resolved. This read cell used to read
 * only the objectui `reference_to` alias.
 *
 * Since objectui#11070 round 4 `reference` is the ONLY spelling it reads — the
 * spelling every other reader reads too — and the second pin below holds the
 * other half: a def that spells only the retired `reference_to` resolves no
 * target here. A served legacy def reaches this cell already folded onto
 * `reference` by the ingestion choke point (`normalizeSchemaReferenceKeys`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { SchemaRendererProvider } from '@object-ui/react';

// A ULID-style id: `isLikelyOpaqueId` returns true for it, so the OLD code
// (which failed to resolve) would fall back to the muted "—" placeholder.
const OPAQUE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function makeDataSource() {
  const findOne = vi.fn(async (object: string, id: string) => {
    if (object === 'showcase_account' && id === OPAQUE_ID) {
      return { id, name: 'Globex' };
    }
    return null;
  });
  return { findOne, find: vi.fn() } as any;
}

describe('LookupCellRenderer — reference key resolution', () => {
  it('resolves an opaque id to a name via the `reference` key', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={OPAQUE_ID}
          // ObjectStack convention: the lookup target lives under `reference`.
          field={{ type: 'lookup', reference: 'showcase_account' } as any}
        />
      </SchemaRendererProvider>,
    );

    // The related record's display name must appear…
    await waitFor(() => {
      expect(screen.getByText('Globex')).toBeInTheDocument();
    });
    // …and the muted placeholder must NOT be what the user sees.
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(ds.findOne).toHaveBeenCalledWith('showcase_account', OPAQUE_ID);
  });

  it('reads no target from a retired `reference_to` (objectui#11070 round 4)', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={OPAQUE_ID}
          field={{ type: 'lookup', reference_to: 'showcase_account' } as never}
        />
      </SchemaRendererProvider>,
    );
    // The raw id stays visible beside the unresolved-reference marker…
    expect(screen.getByText(OPAQUE_ID)).toBeInTheDocument();
    // …because nothing named an object to resolve it through.
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.findOne).not.toHaveBeenCalled();
    expect(screen.queryByText('Globex')).not.toBeInTheDocument();
  });
});
