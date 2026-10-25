/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12335 — the Objects page names the package of the object it
 * deletes.
 *
 * Since objectstack `543b33dee` (`@objectstack/rest` 18.0.0-next.1) the delete
 * door reads `?package=`, and a delete that names no package of an item two
 * packages hold is refused `409 RESOURCE_CONFLICT`. This page lists objects
 * through `GET /meta/object`, whose items carry the server's `_packageId`; it
 * now states that package on `DELETE /meta/object/NAME`, the same served value
 * the metadata list puts on an item's edit link. A row no package owns (no
 * `_packageId`, or the `sys_metadata` sentinel the server stamps on a
 * package-less row) sends none, and a refusal is shown in the page's error
 * panel in the door's own words.
 *
 * The REAL page over a REAL `MetadataClient`; only `ObjectManager` is replaced,
 * by a recorder that hands the test the manager's change callback, exactly as
 * `MetadataObjectsPage.lookupKeying.test.tsx` does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';

interface RecordedManagerProps {
  objects: ObjectDefinition[];
  onObjectsChange?: (objects: ObjectDefinition[]) => void;
}

let managerProps: RecordedManagerProps | null = null;

vi.mock('./ObjectManager', () => ({
  ObjectManager: (props: RecordedManagerProps) => {
    managerProps = props;
    return null;
  },
}));

import { MetadataObjectsPage } from './MetadataObjectsPage';

const served = (name: string, packageId?: string) => ({
  name,
  label: name,
  isSystem: false,
  fields: { title: { type: 'text', label: 'Title' } },
  ...(packageId !== undefined ? { _packageId: packageId } : {}),
});

let serverObjects: Record<string, unknown>[] = [];
/** Every DELETE the door received: the object name and the parsed query. */
let deletes: { name: string; query: URLSearchParams }[] = [];
/** Names whose package-less DELETE the door refuses as ambiguous. */
let ambiguous = new Set<string>();

const AMBIGUOUS =
  "Name the package this delete is for, then send it again: on the REST door add ?package= with the package id, " +
  "in process pass packageId. Nothing was deleted. object 'shared_thing' belongs to 2 packages " +
  "('com.acme.alpha', 'com.acme.beta'), and a delete that names none has no single row to remove.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = new URL(String(input));
      if (method === 'DELETE') {
        const name = decodeURIComponent(url.pathname.split('/api/v1/meta/object/')[1] ?? '');
        deletes.push({ name, query: new URLSearchParams(url.search) });
        if (!url.searchParams.get('package') && ambiguous.has(name)) {
          return json({ error: AMBIGUOUS, code: 'RESOURCE_CONFLICT' }, 409);
        }
        serverObjects = serverObjects.filter((o) => o.name !== name);
        return json({ success: true, reset: true });
      }
      return json({ items: serverObjects });
    }) as unknown as typeof fetch,
  });
}

async function renderPage(expectedRows: number) {
  render(<MetadataObjectsPage client={realClient()} />);
  await waitFor(() => expect(managerProps).not.toBeNull());
  await waitFor(() => expect(managerProps!.objects).toHaveLength(expectedRows));
}

async function deleteThroughManager(name: string) {
  const next = managerProps!.objects.filter((o) => o.name !== name);
  await act(async () => {
    managerProps!.onObjectsChange!(next);
  });
}

beforeEach(() => {
  serverObjects = [];
  deletes = [];
  ambiguous = new Set();
  managerProps = null;
});

describe('MetadataObjectsPage — the delete names the listed row`s package (objectui#12335)', () => {
  it('a package-owned object is deleted with ?package=<its _packageId>', async () => {
    serverObjects = [served('crm_account', 'com.acme.crm')];
    await renderPage(1);

    await deleteThroughManager('crm_account');
    await waitFor(() => expect(deletes).toHaveLength(1));

    expect(deletes[0]!.name).toBe('crm_account');
    expect(deletes[0]!.query.get('package')).toBe('com.acme.crm');
  });

  it('an object no package owns sends no `package` key: absent for the sentinel and for no _packageId', async () => {
    serverObjects = [served('env_note', 'sys_metadata'), served('env_memo')];
    await renderPage(2);

    await deleteThroughManager('env_note');
    await waitFor(() => expect(deletes).toHaveLength(1));
    // The page re-reads after every write; delete the second row off that read.
    await waitFor(() => expect(managerProps!.objects.map((o) => o.name)).toEqual(['env_memo']));
    await deleteThroughManager('env_memo');
    await waitFor(() => expect(deletes).toHaveLength(2));

    for (const d of deletes) expect(d.query.has('package')).toBe(false);
  });

  it('a refused delete reaches the error panel in the door`s words, and the object stays', async () => {
    serverObjects = [served('shared_thing', 'sys_metadata')];
    ambiguous = new Set(['shared_thing']);
    await renderPage(1);

    await deleteThroughManager('shared_thing');
    await waitFor(() => expect(screen.getByTestId('metadata-objects-page-error').textContent).toContain(AMBIGUOUS));

    expect(deletes).toHaveLength(1);
    expect(serverObjects.map((o) => o.name)).toEqual(['shared_thing']);
  });
});
