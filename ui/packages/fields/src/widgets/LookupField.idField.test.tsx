// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression (objectstack #3508): a lookup whose committed value is NOT the
 * primary id (`idField: 'name'` — e.g. approval `position` approvers, which
 * the engine routes by machine name) must hydrate its display label by
 * FILTERING on that field. The old path always called `findOne(object, value)`
 * — a primary-id GET — so a stored machine name never resolved and the field
 * showed an empty placeholder over a real value.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { LookupField } from './LookupField';

afterEach(cleanup);

describe('LookupField — idField hydration (#3508)', () => {
  it('hydrates by filtering on idField when it is not the primary id', async () => {
    const find = vi.fn(async () => ({
      data: [{ id: 'pos_1', name: 'sales_manager', label: 'Sales Manager' }],
    }));
    const findOne = vi.fn(async () => null);
    render(
      <LookupField
        value="sales_manager"
        onChange={() => {}}
        dataSource={{ find, findOne } as never}
        field={{
          reference: 'sys_position',
          idField: 'name',
          displayField: 'label',
          multiple: false,
        } as never}
      />,
    );
    await waitFor(() => expect(find).toHaveBeenCalled());
    // The stored machine name is not a primary id — findOne(object, name)
    // would 404; hydration must go through $filter on the committed field.
    expect(findOne).not.toHaveBeenCalled();
    const hydration = find.mock.calls.find(
      (c) => (c as unknown[])[1] && ((c as never[])[1] as { $filter?: Record<string, unknown> }).$filter?.name === 'sales_manager',
    );
    expect(hydration).toBeTruthy();
  });

  it('keeps findOne hydration for the default primary-id lookup', async () => {
    const find = vi.fn(async () => ({ data: [] }));
    const findOne = vi.fn(async () => ({ id: 'u1', name: 'Ada' }));
    render(
      <LookupField
        value="u1"
        onChange={() => {}}
        dataSource={{ find, findOne } as never}
        field={{ reference: 'sys_user', multiple: false } as never}
      />,
    );
    await waitFor(() => expect(findOne).toHaveBeenCalledWith('sys_user', 'u1'));
  });
});
