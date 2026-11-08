// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `security:effective-access` — a person's effective permission sets on their
 * `sys_user` record page, each with every origin the server's answer carries.
 *
 * Driven through the real input pipeline: the node a page authors
 * (`{ type: 'security:effective-access', properties: {} }`) is rendered by
 * `SchemaRenderer` inside the record context the page binds, and the widget
 * is fed `security.describeEffectiveAccess(userId)`'s answer through the
 * adapter's client.
 *
 *  - §1 a person with access only through the default binding and a position
 *    shows those sets, each with its origin, and the set label;
 *  - §2 CONTROL: a person with one direct grant shows exactly that set;
 *  - §3 a set reached two ways is one row with both origins; derived origins
 *    say which standing;
 *  - §4 a 403 and a 501 show no list, each a quiet line; another failure
 *    names itself; an empty answer says so;
 *  - §5 off a `sys_user` record it renders nothing and reads nothing; a grant
 *    written on the page reads the answer again.
 *
 * `t` echoes the key with any interpolation values appended, so assertions
 * read which string was asked for and with what.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const vals = opts ? Object.values(opts).filter((v) => typeof v === 'string' || typeof v === 'number') : [];
      return vals.length ? `«${key}|${vals.join('|')}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

let adapter: unknown = null;
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import {
  MetadataCtx,
  notifyDataChanged,
  RecordContextProvider,
  SchemaRenderer,
  type MetadataContextValue,
} from '@object-ui/react';
import './UserEffectiveAccess';
import type { SecurityEffectiveAccessSchema } from '@object-ui/types';
import { describeOrigin, type EffectiveAccessAnswer } from './effectiveAccess';

/** The node a page authors, typed on its `@object-ui/types` twin. */
const NODE: SecurityEffectiveAccessSchema = { type: 'security:effective-access', properties: {} };

/** The permission-set catalog the labels come from (`/meta/permission`). */
const CATALOG = [
  { name: 'member_default', label: 'Member default' },
  { name: 'sales_rep', label: 'Sales rep' },
  { name: 'admin_full_access', label: 'Full administrator' },
];

const describeMock = vi.fn<(userId: string) => Promise<EffectiveAccessAnswer>>();
const ensureTypeMock = vi.fn(async (_type: string): Promise<unknown[]> => CATALOG);

function refusal(status: number, message: string): Error {
  return Object.assign(new Error(message), { httpStatus: status });
}

const metadata = {
  ensureType: (type: string) => ensureTypeMock(type),
} as unknown as MetadataContextValue;

function renderOn(objectName: string, recordId: string | null) {
  return render(
    <MetadataCtx.Provider value={metadata}>
      <RecordContextProvider objectName={objectName} recordId={recordId}>
        <SchemaRenderer schema={NODE} />
      </RecordContextProvider>
    </MetadataCtx.Provider>,
  );
}

/** The rendered rows, as set name → origin badge texts. */
async function rowsShown(): Promise<Record<string, string[]>> {
  const list = await screen.findByTestId('effective-access-list');
  const out: Record<string, string[]> = {};
  for (const row of within(list).getAllByRole('listitem').filter((li) => li.dataset.testid?.startsWith('effective-access-row-'))) {
    const name = row.dataset.testid!.slice('effective-access-row-'.length);
    const origins = within(row).getByRole('list');
    out[name] = within(origins).getAllByRole('listitem').map((li) => li.textContent ?? '');
  }
  return out;
}

beforeEach(() => {
  describeMock.mockReset();
  ensureTypeMock.mockClear();
  adapter = { getClient: () => ({ security: { describeEffectiveAccess: describeMock } }) };
});

afterEach(() => {
  cleanup();
});

describe('§0 registration', () => {
  it('is registered as security:effective-access, with no bare fallback', () => {
    expect(ComponentRegistry.get('security:effective-access')).toBeDefined();
    expect(ComponentRegistry.get('effective-access')).toBeUndefined();
  });
});

describe('§1 access only through the default binding and a position', () => {
  it('shows those sets with their origins, not an empty list', async () => {
    describeMock.mockResolvedValueOnce({
      userId: 'user_mia',
      organizationId: 'org_here',
      positions: ['org_member', 'sales', 'everyone'],
      permissionSets: [
        { name: 'sales_rep', origins: [{ kind: 'position', position: 'sales' }] },
        { name: 'member_default', origins: [{ kind: 'default' }] },
      ],
    });
    renderOn('sys_user', 'user_mia');

    expect(await rowsShown()).toEqual({
      sales_rep: ['«effectiveAccess.origin.position|sales»'],
      member_default: ['«effectiveAccess.origin.default»'],
    });
    expect(describeMock).toHaveBeenCalledWith('user_mia');
    expect(screen.queryByTestId('effective-access-empty')).toBeNull();
  });

  it('shows each set by its catalog label, with the name beside it', async () => {
    describeMock.mockResolvedValueOnce({
      userId: 'user_mia',
      organizationId: 'org_here',
      positions: ['everyone'],
      permissionSets: [{ name: 'member_default', origins: [{ kind: 'default' }] }],
    });
    renderOn('sys_user', 'user_mia');
    const row = await screen.findByTestId('effective-access-row-member_default');
    await waitFor(() => expect(within(row).getByText('Member default')).toBeInTheDocument());
    expect(within(row).getByText('member_default')).toBeInTheDocument();
    expect(ensureTypeMock).toHaveBeenCalledWith('permission');
  });

  it('shows a set the catalog does not list by its name, never drops it', async () => {
    ensureTypeMock.mockResolvedValueOnce([]);
    describeMock.mockResolvedValueOnce({
      userId: 'user_mia',
      organizationId: 'org_here',
      positions: [],
      permissionSets: [{ name: 'uncatalogued_set', origins: [{ kind: 'default' }] }],
    });
    renderOn('sys_user', 'user_mia');
    const row = await screen.findByTestId('effective-access-row-uncatalogued_set');
    expect(within(row).getAllByText('uncatalogued_set')).toHaveLength(1);
  });
});

describe('§2 CONTROL — one direct grant', () => {
  it('shows exactly that set, as a direct grant', async () => {
    describeMock.mockResolvedValueOnce({
      userId: 'user_ana',
      organizationId: 'org_here',
      positions: [],
      permissionSets: [{ name: 'sales_rep', origins: [{ kind: 'direct' }] }],
    });
    renderOn('sys_user', 'user_ana');
    expect(await rowsShown()).toEqual({ sales_rep: ['«effectiveAccess.origin.direct»'] });
  });
});

describe('§3 a set reached two ways', () => {
  it('is one row carrying both origins, in the answer\'s order', async () => {
    describeMock.mockResolvedValueOnce({
      userId: 'user_mia',
      organizationId: 'org_here',
      positions: ['sales'],
      permissionSets: [
        { name: 'sales_rep', origins: [{ kind: 'direct' }, { kind: 'position', position: 'sales' }] },
        {
          name: 'admin_full_access',
          origins: [{ kind: 'direct' }, { kind: 'derived', source: 'platform_admin_config' }],
        },
        { name: 'ai_seat', origins: [{ kind: 'derived', source: 'ai_access' }] },
      ],
    });
    renderOn('sys_user', 'user_mia');
    expect(await rowsShown()).toEqual({
      sales_rep: ['«effectiveAccess.origin.direct»', '«effectiveAccess.origin.position|sales»'],
      admin_full_access: ['«effectiveAccess.origin.direct»', '«effectiveAccess.origin.derivedPlatformAdmin»'],
      ai_seat: ['«effectiveAccess.origin.derivedAiAccess»'],
    });
    expect(screen.getAllByTestId(/^effective-access-row-/)).toHaveLength(3);
  });

  it('describes every origin kind the contract declares', () => {
    const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${Object.values(opts).join('|')}` : key);
    expect(describeOrigin({ kind: 'direct' }, t)).toBe('effectiveAccess.origin.direct');
    expect(describeOrigin({ kind: 'position', position: 'org_external' }, t)).toBe('effectiveAccess.origin.position|org_external');
    expect(describeOrigin({ kind: 'default' }, t)).toBe('effectiveAccess.origin.default');
    expect(describeOrigin({ kind: 'derived', source: 'platform_admin_config' }, t)).toBe('effectiveAccess.origin.derivedPlatformAdmin');
    expect(describeOrigin({ kind: 'derived', source: 'ai_access' }, t)).toBe('effectiveAccess.origin.derivedAiAccess');
  });
});

describe('§4 refusals never draw a list', () => {
  it('a 403 (a person the caller may not manage) leaves one quiet line and no list', async () => {
    describeMock.mockRejectedValueOnce(refusal(403, 'Forbidden'));
    renderOn('sys_user', 'user_other');
    expect(await screen.findByTestId('effective-access-refused')).toHaveTextContent('«effectiveAccess.refused»');
    expect(screen.queryByTestId('effective-access-list')).toBeNull();
    expect(screen.queryByTestId('effective-access-empty')).toBeNull();
  });

  it('a 501 (a server without the read) leaves one quiet line and no list', async () => {
    describeMock.mockRejectedValueOnce(refusal(501, 'Not implemented'));
    renderOn('sys_user', 'user_mia');
    expect(await screen.findByTestId('effective-access-unserved')).toHaveTextContent('«effectiveAccess.unserved»');
    expect(screen.queryByTestId('effective-access-list')).toBeNull();
    expect(screen.queryByTestId('effective-access-empty')).toBeNull();
  });

  it('any other failure names itself, and draws no list', async () => {
    describeMock.mockRejectedValueOnce(refusal(500, 'authorization store could not be read'));
    renderOn('sys_user', 'user_mia');
    expect(await screen.findByTestId('effective-access-failed')).toHaveTextContent(
      '«effectiveAccess.loadFailed|authorization store could not be read»',
    );
    expect(screen.queryByTestId('effective-access-list')).toBeNull();
  });

  it('an answer with no set says so', async () => {
    describeMock.mockResolvedValueOnce({ userId: 'user_mia', organizationId: null, positions: [], permissionSets: [] });
    renderOn('sys_user', 'user_mia');
    expect(await screen.findByTestId('effective-access-empty')).toHaveTextContent('«effectiveAccess.empty»');
  });
});

describe('§5 where it draws, and when it reads again', () => {
  it('renders nothing and reads nothing off a sys_user record', () => {
    const other = renderOn('crm_account', 'acc_1');
    expect(other.container).toBeEmptyDOMElement();
    other.unmount();
    const noId = renderOn('sys_user', null);
    expect(noId.container).toBeEmptyDOMElement();
    expect(describeMock).not.toHaveBeenCalled();
  });

  it('reads the answer again when a grant on the page changes', async () => {
    describeMock.mockResolvedValue({
      userId: 'user_mia',
      organizationId: 'org_here',
      positions: [],
      permissionSets: [{ name: 'sales_rep', origins: [{ kind: 'direct' }] }],
    });
    renderOn('sys_user', 'user_mia');
    await screen.findByTestId('effective-access-list');
    expect(describeMock).toHaveBeenCalledTimes(1);
    notifyDataChanged({ objectName: 'sys_user_permission_set' });
    await waitFor(() => expect(describeMock).toHaveBeenCalledTimes(2));
  });
});
