/**
 * [framework#2926 ⑧] LookupCellRenderer must honor the target object's
 * configured display field. ObjectGrid forwards `displayField` on the
 * column meta (RELATIONAL_META_KEYS) exactly like `reference`, but the read
 * cell used to ignore it and always ran the hardcoded heuristics — `name`
 * first — so a target object whose displayNameField is a localized/label
 * field still rendered the raw API `name`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { SchemaRendererProvider } from '@object-ui/react';

const ID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const ID_B = '01ARZ3NDEKTSV4RRFFQ69G5FAB';

function makeDataSource() {
  const findOne = vi.fn(async (object: string, id: string) => {
    if (object === 'showcase_category') {
      // Record carries BOTH the raw API name and a localized label field.
      if (id === ID_A) return { id, name: 'cat_hardware', label_zh: '硬件' };
      if (id === ID_B) return { id, name: 'cat_software', label_zh: '软件' };
    }
    return null;
  });
  return { findOne, find: vi.fn() } as any;
}

describe('LookupCellRenderer — displayField resolution', () => {
  it('prefers the configured displayField over the heuristic `name`', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={ID_A}
          field={{ type: 'lookup', reference: 'showcase_category', displayField: 'label_zh' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('硬件')).toBeInTheDocument();
    });
    expect(screen.queryByText('cat_hardware')).not.toBeInTheDocument();
  });

  it('keeps the heuristic (`name` first) when no displayField is configured', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={ID_A}
          field={{ type: 'lookup', reference: 'showcase_category' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('cat_hardware')).toBeInTheDocument();
    });
  });

  it('uses displayField on server-expanded nested objects (no fetch path)', () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={{ id: ID_A, name: 'cat_hardware', label_zh: '硬件' } as any}
          field={{ type: 'lookup', reference: 'showcase_category', displayField: 'label_zh' } as any}
        />
      </SchemaRendererProvider>,
    );
    expect(screen.getByText('硬件')).toBeInTheDocument();
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('does not serve a cached heuristic name to a displayField column (cache key isolation)', async () => {
    const ds = makeDataSource();
    // First: a column WITHOUT displayField resolves and caches the heuristic name.
    const first = render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={ID_B}
          field={{ type: 'lookup', reference: 'showcase_category' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('cat_software')).toBeInTheDocument();
    });
    first.unmount();
    // Then: a column WITH displayField for the same record must show the
    // configured field, not the previously cached heuristic name.
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={ID_B}
          field={{ type: 'lookup', reference: 'showcase_category', displayField: 'label_zh' } as any}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('软件')).toBeInTheDocument();
    });
  });
});
