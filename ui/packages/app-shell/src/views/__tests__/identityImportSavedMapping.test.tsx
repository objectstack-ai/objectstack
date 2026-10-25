/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The LAST link of objectui#7740: the saved-mapping selector actually RENDERS
 * on `sys_user`.
 *
 * Director seat, decision batch #68 (ledger objectstack#12708) ruled that
 * identity import offers saved mappings. Its sibling pins in
 * `identityImport.test.ts` assert the wrapper EXPRESSES the capability and that
 * the #7741 three-state read reaches `sys_user` through it. Neither of them
 * renders anything, and this card is fundamentally about a piece of UI that was
 * missing — so the chain is only closed by driving the real wizard.
 *
 * Nothing between the two ends is stubbed: the real `ObjectStackAdapter`, the
 * real `createIdentityImportDataSource` wrapper, the real `ImportWizard`. Only
 * `fetch` is replaced, because it stands in for the server.
 *
 * `ImportWizard` is imported at module scope rather than through `ObjectView`'s
 * `React.lazy` boundary (AGENTS.md 测试纪律): the cost then lands in the import
 * phase, which no test timeout bounds, instead of racing `findBy*`'s budget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '@object-ui/plugin-grid';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import { createIdentityImportDataSource, IDENTITY_IMPORT_OBJECT } from '../identityImport';

const BASE_URL = 'http://identity-import-selector-pin.local';

/** sys_user columns an admin would actually paste. */
const FIELDS = [
  { name: 'email', label: 'Email', type: 'text', required: true },
  { name: 'name', label: 'Name', type: 'text' },
];

/** A `mapping` artifact registered against sys_user, in the shape the
 *  framework's REST list door was measured to emit (see #7741's own pin). */
const STAFF_ROSTER = {
  name: 'staff_roster',
  label: 'Staff roster',
  sourceFormat: 'csv',
  targetObject: 'sys_user',
  fieldMapping: [
    { source: 'Work Email', target: 'email', transform: 'none' },
    { source: 'Full Name', target: 'name', transform: 'none' },
  ],
  mode: 'insert',
  _diagnostics: { valid: true },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Records every URL the wizard's probe actually reached for. */
const requested: string[] = [];

function makeAdapter(items: unknown[]) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/api/v1/discovery')) {
      return json({ success: true, data: { capabilities: {}, routes: {} } });
    }
    if (url.endsWith('/api/v1/meta/mapping')) return json({ type: 'mapping', items });
    return json({ success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  return new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl as any, autoReconnect: false });
}

const askedForMappings = () => requested.some((u) => u.endsWith('/api/v1/meta/mapping'));

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

function renderIdentityWizard(base: unknown) {
  const ds = createIdentityImportDataSource({
    base,
    authFetch: vi.fn() as any,
    baseUrl: BASE_URL,
    getPasswordPolicy: () => 'auto',
  });
  render(
    <ImportWizard
      objectName={IDENTITY_IMPORT_OBJECT}
      fields={FIELDS}
      dataSource={ds as any}
      open
      onOpenChange={() => {}}
    />,
  );
  return ds;
}

describe('identity import: the saved-mapping selector on sys_user (objectui#7740)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearSharedDiscoveryCache();
    requested.length = 0;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    warnSpy.mockRestore();
  });

  it('renders the selector when a mapping targets sys_user', async () => {
    renderIdentityWizard(makeAdapter([STAFF_ROSTER]));
    pasteRows('Work Email\tFull Name\na@x.co\tAda');

    // This is the assertion the card is about: before the explicit forward the
    // wizard's `typeof … === 'function'` probe failed on the wrapper, so this
    // bar could not appear on sys_user for any deployment, ever.
    //
    // `SavedMappingBar` returns null on an empty list, so its presence is not
    // merely "something rendered" — it means the read reached the server, came
    // back, survived `asSavedMapping`, and matched `targetObject: 'sys_user'`.
    // The option rows themselves live in a Radix portal that only mounts once
    // the select is opened, so they are deliberately not asserted here; the two
    // negative arms below carry the discrimination instead.
    const bar = await screen.findByTestId('import-saved-mapping-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('import-saved-mapping-select')).toBeInTheDocument();
    expect(askedForMappings()).toBe(true);
  });

  it('does not render the selector when no mapping targets sys_user', async () => {
    // The other half of the same feature detection — an empty list still hides
    // it, so the pin above is measuring the mapping and not merely the render.
    renderIdentityWizard(makeAdapter([{ ...STAFF_ROSTER, name: 'task_feed', targetObject: 'task' }]));
    pasteRows('Work Email\tFull Name\na@x.co\tAda');

    await screen.findByTestId('import-next-btn'); // the mapping step is up
    await waitFor(() => expect(askedForMappings()).toBe(true)); // it DID ask...
    expect(screen.queryByTestId('import-saved-mapping-bar')).not.toBeInTheDocument(); // ...and got nothing for sys_user
  });

  it('does not render the selector when the base adapter has no listImportMappings', async () => {
    // A base that genuinely lacks the capability must not gain one from the
    // wrapper — the `?.` in the forward is what keeps that true.
    renderIdentityWizard({ find: 'passthrough-marker' });
    pasteRows('Work Email\tFull Name\na@x.co\tAda');

    await screen.findByTestId('import-next-btn');
    await waitFor(() => {
      expect(screen.queryByTestId('import-saved-mapping-bar')).not.toBeInTheDocument();
    });
    expect(askedForMappings()).toBe(false); // the probe never even fired
  });
});
