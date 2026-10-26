// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { FilterScopeProvider } from '@object-ui/react';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

/**
 * Regression cover for framework #3574.
 *
 * A user-scoped dashboard widget sent `{current_user_id}` to the analytics
 * service as a literal string. It matched no record, the widget rendered `0`,
 * and nothing was logged on the client or the server — a silent zero that
 * reads as "you have no work" rather than "this filter did not resolve".
 *
 * These assert on the `runtimeFilter` actually handed to `queryDataset`,
 * because that is the seam the bug lived at: the widget rendered fine, the
 * query ran fine, and only the filter payload was wrong.
 */
describe('DatasetWidget — filter placeholder resolution (#3574)', () => {
  const makeSource = () => ({ queryDataset: vi.fn(async () => ({ rows: [{ revenue: 7 }] })) });

  it('resolves {current_user_id} against the mounted filter scope', async () => {
    const src = makeSource();
    render(
      <FilterScopeProvider currentUserId="usr_42" currentOrgId="org_7">
        <DatasetWidget
          widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { owner: '{current_user_id}' } }}
          dataSource={src}
        />
      </FilterScopeProvider>,
    );

    await waitFor(() =>
      expect(src.queryDataset).toHaveBeenCalledWith('sales', {
        dimensions: [],
        measures: ['revenue'],
        runtimeFilter: { owner: 'usr_42' },
      }),
    );
  });

  it('resolves {current_org_id} too', async () => {
    const src = makeSource();
    render(
      <FilterScopeProvider currentUserId="usr_42" currentOrgId="org_7">
        <DatasetWidget
          widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { org: '{current_org_id}' } }}
          dataSource={src}
        />
      </FilterScopeProvider>,
    );

    await waitFor(() =>
      expect(src.queryDataset).toHaveBeenCalledWith('sales', {
        dimensions: [],
        measures: ['revenue'],
        runtimeFilter: { org: 'org_7' },
      }),
    );
  });

  it('resolves session tokens and date macros in the same filter', async () => {
    const src = makeSource();
    render(
      <FilterScopeProvider currentUserId="usr_42" currentOrgId={null}>
        <DatasetWidget
          widget={{
            type: 'metric',
            dataset: 'sales',
            values: ['revenue'],
            filter: { owner: '{current_user_id}', created_at: { $gte: '{today}' } },
          }}
          dataSource={src}
        />
      </FilterScopeProvider>,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const runtimeFilter = (src.queryDataset.mock.calls[0] as any[])[1].runtimeFilter;
    expect(runtimeFilter.owner).toBe('usr_42');
    // The date macro must be expanded to a real ISO date, not left as a token.
    expect(runtimeFilter.created_at.$gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves a non-user-scoped filter untouched', async () => {
    const src = makeSource();
    render(
      <FilterScopeProvider currentUserId="usr_42" currentOrgId="org_7">
        <DatasetWidget
          widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { stage: { $nin: ['lost'] } } }}
          dataSource={src}
        />
      </FilterScopeProvider>,
    );

    await waitFor(() =>
      expect(src.queryDataset).toHaveBeenCalledWith('sales', {
        dimensions: [],
        measures: ['revenue'],
        runtimeFilter: { stage: { $nin: ['lost'] } },
      }),
    );
  });

  // Signed out / no provider: the token stays intact so the query matches
  // nothing. Dropping the clause instead would WIDEN the result set and show
  // a signed-out viewer everyone's data — strictly worse than showing none.
  it('leaves the token intact when no scope is mounted, never widening the filter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = makeSource();
    render(
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], filter: { owner: '{current_user_id}' } }}
        dataSource={src}
      />,
    );

    await waitFor(() =>
      expect(src.queryDataset).toHaveBeenCalledWith('sales', {
        dimensions: [],
        measures: ['revenue'],
        runtimeFilter: { owner: '{current_user_id}' },
      }),
    );
    // …and it is no longer silent: the unresolved token is reported.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('current_user_id'))).toBe(true);
    warn.mockRestore();
  });
});
