/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression coverage for Phase O.0: RelatedList must scope its auto-fetch
 * with `$filter: { [referenceField]: parentId }`. Without those two props
 * the fetch is skipped entirely (we don't want to dump every row of the
 * target object).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

const makeDS = (rows: any[]) => ({
  find: vi.fn(async () => rows),
});

describe('RelatedList — parent-scoped auto-fetch (O.0)', () => {
  it('passes $filter with referenceField + parentId when both provided', async () => {
    const ds = makeDS([{ id: 'c1', name: 'Alice' }]);
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="account"
        parentId="ACC-1"
        dataSource={ds as any}
      />,
    );
    await waitFor(() => {
      expect(ds.find).toHaveBeenCalledWith('contact', { $filter: { account: 'ACC-1' } });
    });
  });

  it('refuses to fetch when referenceField is missing (avoids dumping all rows)', async () => {
    const ds = makeDS([{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        parentId="ACC-1"
        dataSource={ds as any}
      />,
    );
    // Give the effect a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(ds.find).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses to fetch when parentId is missing', async () => {
    const ds = makeDS([{ id: 'x' }]);
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="account"
        dataSource={ds as any}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('respects caller-provided data (no fetch even with no parentId)', async () => {
    const ds = makeDS([{ id: 'should-not-appear' }]);
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        data={[{ id: 'p1', name: 'Passed' }]}
        dataSource={ds as any}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(ds.find).not.toHaveBeenCalled();
  });
});
