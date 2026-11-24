// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35054 (route D) — `ObjectStackAdapter.getAuthoredItem` answers
 * the published item as its author stored it, from the untranslated layers.
 *
 * The writers that send a whole document back through the metadata door
 * (`EditAppPage`, App management, navigation sync, Publish an app) start from
 * this instead of the served read, which is translated for the console's
 * locale. Pinned here: the address it reads, the layer it answers, and that an
 * absent item is `null` and a refused read throws.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

function adapterAnswering(status: number, body: unknown) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const ds = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  return { ds, urls };
}

const STORED = { name: 'qatr_app', label: 'QA Translate App', navigation: [{ id: 'nav_my_work', type: 'page', label: 'My Work' }] };

describe('ObjectStackAdapter.getAuthoredItem (objectstack#35054)', () => {
  it('reads /layers at the package named and answers the published layer as stored', async () => {
    const { ds, urls } = adapterAnswering(200, {
      code: null,
      overlay: null,
      overlayScope: null,
      effective: STORED,
      draft: { ...STORED, label: 'Draft label' },
    });
    await expect(ds.getAuthoredItem('app', 'qatr_app', { packageId: 'com.qa.tr' })).resolves.toEqual(STORED);
    expect(urls).toEqual(['http://test.local/api/v1/meta/app/qatr_app/layers?package=com.qa.tr']);
  });

  it('answers an object’s overlay over its code, as the object editors do', async () => {
    const { ds } = adapterAnswering(200, {
      code: { name: 'task', label: 'Task (code)' },
      overlay: { name: 'task', label: 'Task (overlay)' },
      overlayScope: 'env',
      effective: { name: 'task', label: 'Task (effective)' },
    });
    await expect(ds.getAuthoredItem('object', 'task')).resolves.toEqual({ name: 'task', label: 'Task (overlay)' });
  });

  it('is null when no layer holds the item', async () => {
    const { ds } = adapterAnswering(404, { error: 'not found' });
    await expect(ds.getAuthoredItem('app', 'missing_app')).resolves.toBeNull();
  });

  it('throws on a refused read: nothing is guessed', async () => {
    const { ds } = adapterAnswering(403, { error: { code: 'FORBIDDEN', message: 'manage_metadata required' } });
    await expect(ds.getAuthoredItem('app', 'qatr_app')).rejects.toMatchObject({ status: 403 });
  });
});
