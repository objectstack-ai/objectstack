/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

/**
 * Regression: a 403 from the data source used to render the same
 * "check your connection" panel as a genuine network failure — a permission
 * denial and an outage were indistinguishable, sending users (and ops) to
 * debug their network while the server was correctly denying access.
 * The error panel must classify by HTTP status / error code.
 *
 * The same mistake was still being made one status code over. A **400** is the
 * server saying it understood the request and will never accept it — a stored
 * filter it cannot parse (objectstack#4121 now returns `INVALID_FILTER`), or an
 * unsupported `$`-parameter. Retrying resends the identical bad request, so
 * "check your connection and try again" is advice that cannot work.
 */

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  fields: ['name'],
};

function renderFailing(error: unknown) {
  const ds = {
    find: vi.fn().mockRejectedValue(error),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} />
    </SchemaRendererProvider>,
  );
}

async function errorState(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector('[data-testid="list-error-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="list-error-state"]') as HTMLElement;
}

describe('ListView – load-error classification', () => {
  it('renders the permission-denied panel for a 403 (httpStatus)', async () => {
    const err = Object.assign(new Error('Forbidden'), { httpStatus: 403 });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
    expect(panel.textContent).toMatch(/permission|access/i);
    expect(panel.textContent).not.toMatch(/connection/i);
  });

  it('classifies a PERMISSION_DENIED error code without a numeric status', async () => {
    const err = Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
  });

  it('classifies a status embedded in the message text ("HTTP 403 …")', async () => {
    const { container } = renderFailing(new Error('ApiDataSource: HTTP 403 Forbidden — {}'));
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
  });

  it('renders the sign-in panel for a 401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { httpStatus: 401 });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('unauthorized');
  });

  it('keeps the connection copy for a plain network failure', async () => {
    const { container } = renderFailing(new TypeError('Failed to fetch'));
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('network');
    expect(panel.textContent).toMatch(/connection/i);
  });

  it('renders the rejected-query panel for a 400, not the connection copy', async () => {
    const err = Object.assign(new Error('Malformed $filter'), { httpStatus: 400 });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('rejected');
    expect(panel.textContent).toMatch(/filter|query/i);
    // The advice that cannot work: retrying resends the same bad request.
    expect(panel.textContent).not.toMatch(/connection/i);
  });

  it('classifies the server\u2019s INVALID_FILTER code without a numeric status', async () => {
    // objectstack#4121 — a `$filter` array that is not a filter AST.
    const err = Object.assign(new Error('Malformed $filter'), { code: 'INVALID_FILTER' });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('rejected');
  });

  it('classifies UNSUPPORTED_QUERY_PARAM the same way', async () => {
    const err = Object.assign(new Error('Unsupported query parameter(s): $bogus'), {
      code: 'UNSUPPORTED_QUERY_PARAM',
    });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('rejected');
  });

  it('classifies a 400 embedded in the message text', async () => {
    const { container } = renderFailing(new Error('ApiDataSource: HTTP 400 Bad Request — {}'));
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('rejected');
  });

  /**
   * objectui#4408 — the `enable`-block denials. Both are pure functions of the
   * object's metadata (`apiAccessDenialFromEnable`), so they are permanent,
   * identical for every persona, and unaffected by any retry. Neither the
   * network copy ("check your connection") nor the permission copy ("ask your
   * administrator for access") is true of them, and the empty state — what the
   * 404 half used to reach, because the adapter degraded it to zero rows — is
   * the furthest from true of all.
   */
  describe('enable-block API denials (#4408)', () => {
    it('renders the cannot-work panel for a 404 OBJECT_API_DISABLED', async () => {
      const err = Object.assign(new Error('Object API is disabled'), {
        httpStatus: 404,
        code: 'OBJECT_API_DISABLED',
      });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('api-disabled');
      // Says the object is not exposed through the API…
      expect(panel.textContent).toMatch(/API/);
      // …and tells neither of the lies this kind exists to stop: the network
      // is fine, and the list is not merely unpopulated.
      expect(panel.textContent).not.toMatch(/connection/i);
      expect(panel.textContent).not.toMatch(/no records|nothing here|no items/i);
      // It must not read as a permission the user could be granted either. The
      // copy names that distinction explicitly rather than omitting the word,
      // so this asserts the disclaimer, not the absence of the term — and it
      // must not be the forbidden panel's copy.
      expect(panel.textContent).toMatch(/not a permission/i);
      expect(panel.textContent).not.toMatch(/don’t have permission|contact your administrator if you think/i);
    });

    it('renders the same panel for the 405 sibling OBJECT_API_METHOD_NOT_ALLOWED', async () => {
      const err = Object.assign(new Error('Method not allowed'), {
        httpStatus: 405,
        code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('api-disabled');
    });

    it('classifies on the code alone, with no numeric status', async () => {
      // The raw `$expand`/`$search` branch used to drop the code entirely; the
      // status can never carry this verdict on its own, so the code is what is
      // asserted here.
      const err = Object.assign(new Error('denied'), { code: 'OBJECT_API_DISABLED' });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('api-disabled');
    });

    it('offers no Retry — every retry re-fetches the identical refusal', async () => {
      const err = Object.assign(new Error('Object API is disabled'), {
        httpStatus: 404,
        code: 'OBJECT_API_DISABLED',
      });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.querySelector('[data-testid="list-error-retry"]')).toBeNull();
    });

    it('CONTROL: a bare 404 with no code is NOT an enable-block denial', async () => {
      // A missing record or a collection this backend doesn't have. Status
      // alone must never reach the api-disabled copy, or every 404 in the
      // product starts claiming the object was switched off.
      const err = Object.assign(new Error('Not found'), { httpStatus: 404 });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).not.toBe('api-disabled');
      expect(panel.getAttribute('data-error-kind')).toBe('network');
    });

    it('CONTROL: RECORD_NOT_FOUND / OBJECT_NOT_FOUND are not enable-block denials', async () => {
      for (const code of ['RECORD_NOT_FOUND', 'OBJECT_NOT_FOUND']) {
        const err = Object.assign(new Error('missing'), { httpStatus: 404, code });
        const { container } = renderFailing(err);
        const panel = await errorState(container);
        expect(panel.getAttribute('data-error-kind')).not.toBe('api-disabled');
      }
    });

    it('CONTROL: a 403 still classifies as forbidden, not api-disabled', async () => {
      const err = Object.assign(new Error('Forbidden'), {
        httpStatus: 403,
        code: 'PERMISSION_DENIED',
      });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
    });
  });

  it('still prefers 403/401 over the 400 branch', async () => {
    // Ordering guard: a permission denial must never read as a bad request.
    for (const [status, kind] of [[403, 'forbidden'], [401, 'unauthorized']] as const) {
      const { container } = renderFailing(Object.assign(new Error('x'), { httpStatus: status }));
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe(kind);
    }
  });
});
