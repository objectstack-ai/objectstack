/**
 * Regression for objectstack-ai/objectui#2357: the lookup chip
 * (LookupCellRenderer — record header highlight + detail sections) resolved
 * display names via the local key heuristic (`pickRecordDisplayName`), whose
 * `_number`/`_code` suffix scan surfaced an autonumber (`0001`) over the
 * record's real name whenever the referenced object declared its title in
 * `nameField`/`titleFormat`. The picker (LookupField) already resolved via the
 * unified ADR-0079 resolver, so the two surfaces disagreed.
 *
 * The chip must now resolve through the referenced object's schema
 * (`dataSource.getObjectSchema`) with the precedence
 * `displayField → nameField/titleFormat → type-aware derivation`, keeping the
 * key heuristic only as the no-schema fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { SchemaRendererProvider } from '@object-ui/react';

// The expanded record: the autonumber (`req_number`) precedes the real name
// (`req_name`) in key order, so the OLD heuristic-only path rendered "0001".
const EXPANDED = { id: 'rec1', req_number: '0001', req_name: 'Annual Maintenance' };

function makeDataSource(objectName: string, schema: any, record?: any) {
  return {
    find: vi.fn(),
    findOne: vi.fn(async (object: string, id: string) =>
      object === objectName && record && id === record.id ? record : null,
    ),
    getObjectSchema: vi.fn(async (object: string) =>
      object === objectName ? schema : null,
    ),
  } as any;
}

describe('LookupCellRenderer — schema-aware display name (issue #2357)', () => {
  it('expanded object: nameField beats the autonumber suffix heuristic', async () => {
    const ds = makeDataSource('mtc_request_a', { nameField: 'req_name' });
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={EXPANDED}
          field={{ type: 'lookup', reference: 'mtc_request_a' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Annual Maintenance')).toBeInTheDocument();
    });
    expect(screen.queryByText('0001')).not.toBeInTheDocument();
  });

  it('expanded object: titleFormat template resolves when no nameField', async () => {
    const ds = makeDataSource('mtc_request_b', { titleFormat: '{req_name} - {req_number}' });
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={{ ...EXPANDED }}
          field={{ type: 'lookup', reference: 'mtc_request_b' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Annual Maintenance - 0001')).toBeInTheDocument();
    });
  });

  it('explicit displayField wins over the schema nameField', async () => {
    const ds = makeDataSource('mtc_request_c', { nameField: 'req_name' });
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={{ ...EXPANDED }}
          field={{ type: 'lookup', reference: 'mtc_request_c', display_field: 'req_number' } as any}
        />
      </SchemaRendererProvider>,
    );
    // Author explicitly asked for the number — honour it (also the documented
    // workaround in the issue).
    expect(await screen.findByText('0001')).toBeInTheDocument();
  });

  it('fetch-on-demand primitive id resolves via the schema nameField too', async () => {
    // Opaque ULID-ish id so the old path would have resolved the fetched
    // record through the heuristic and shown its autonumber.
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FBB';
    const record = { id, req_number: '0007', req_name: 'Pump Overhaul' };
    const ds = makeDataSource('mtc_request_d', { nameField: 'req_name' }, record);
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={id}
          field={{ type: 'lookup', reference: 'mtc_request_d' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Pump Overhaul')).toBeInTheDocument();
    });
    expect(screen.queryByText('0007')).not.toBeInTheDocument();
    expect(ds.getObjectSchema).toHaveBeenCalledWith('mtc_request_d');
  });

  it('falls back to the key heuristic when the data source has no schema API', () => {
    const ds = { find: vi.fn(), findOne: vi.fn() } as any; // no getObjectSchema
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={{ id: 'rec2', framework_name: 'SOX' }}
          field={{ type: 'lookup', reference: 'mtc_request_e' } as any}
        />
      </SchemaRendererProvider>,
    );
    expect(screen.getByText('SOX')).toBeInTheDocument();
  });
});
