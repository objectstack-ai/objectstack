/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An object create form opened from a `{ objectName, mode: 'create' }`
 * descriptor is titled by its object (#30126 item 2).
 *
 * The descriptor's only producer is the lookup field's inline "create the
 * referenced record", which passes no title, so the dialog had no heading and
 * opened straight onto the first section's name. It now reads
 * `form.createTitle`, the console's own New dialog title. An authored title
 * still wins, and an edit form is not given a create title.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetadataCtx } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { useActionModal } from '../useActionModal';

afterEach(cleanup);

type Handler = (schema: unknown) => Promise<unknown>;

const REPAIR_TICKET = { name: 'repair_ticket', label: 'Repair Ticket', fields: { subject: { type: 'text', label: 'Subject' } } };

const dataSource = {
  getObjectSchema: async () => REPAIR_TICKET,
  find: async () => ({ data: [], total: 0 }),
  findOne: async () => null,
};

const metadata: any = {
  apps: [], objects: [REPAIR_TICKET], dashboards: [], reports: [], pages: [],
  loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready',
};

function Harness({ onReady }: { onReady: (h: Handler) => void }) {
  const { modalHandler, modalElement } = useActionModal(dataSource);
  React.useEffect(() => onReady(modalHandler), [onReady, modalHandler]);
  return <>{modalElement}</>;
}

async function open(descriptor: Record<string, unknown>, language?: string) {
  let handler: Handler | null = null;
  const harness = (
    <MetadataCtx.Provider value={metadata}>
      <Harness onReady={(h) => { handler = h; }} />
    </MetadataCtx.Provider>
  );
  render(language ? <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{harness}</I18nProvider> : harness);
  await act(async () => {
    void handler!(descriptor);
  });
  return screen.findByRole('dialog');
}

describe('useActionModal: an object create form is titled by its object (#30126 item 2)', () => {
  it('a create descriptor with no title reads form.createTitle', async () => {
    await open({ objectName: 'repair_ticket', mode: 'create' });
    expect(await screen.findByRole('heading', { name: 'Create Repair Ticket' })).toBeInTheDocument();
  });

  it('in a zh session it is the zh title, spaced from a Latin label', async () => {
    await open({ objectName: 'repair_ticket', mode: 'create' }, 'zh');
    expect(await screen.findByRole('heading', { name: '新建 Repair Ticket' })).toBeInTheDocument();
  });

  it('an authored title still wins', async () => {
    await open({ objectName: 'repair_ticket', mode: 'create', title: 'Log a repair' });
    expect(await screen.findByRole('heading', { name: 'Log a repair' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create Repair Ticket' })).toBeNull();
  });

  it('CONTROL: an edit form is not given a create title', async () => {
    await open({ objectName: 'repair_ticket', mode: 'edit', recordId: 't1' });
    expect(screen.queryByRole('heading', { name: 'Create Repair Ticket' })).toBeNull();
  });
});
