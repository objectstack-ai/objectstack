/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#36425 — a create or edit an action opens
 * (`useActionModal`, a `{ objectName, mode }` descriptor: the lookup's
 * "+ New", an object-bound action) no longer loads the object's internal form
 * view. It lays the record out as the console's New / Edit dialog does: the
 * object's listed fields arranged by its field groups, so a field the form view
 * left out appears, the form view's section headings do not, and a create
 * leaves out a `showOnCreate: false` field that an edit shows.
 *
 * The real `ModalForm` renders, through the hook, over a served object that
 * carries an internal form view (the shape `MetadataProvider` merges on).
 * CONTROL: a descriptor naming its own `fields` keeps them.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MetadataCtx } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { useActionModal } from '../useActionModal';

registerAllFields();
afterEach(cleanup);

type Handler = (schema: unknown) => Promise<unknown>;

const FIELDS = {
  title: { type: 'text', label: 'Title', group: 'basics' },
  summary: { type: 'textarea', label: 'Summary', group: 'basics' },
  secret_internal: { type: 'text', label: 'Secret Internal', group: 'more' },
  later_note: { type: 'text', label: 'Later Note', group: 'more', showOnCreate: false },
};
const FIELD_GROUPS = [
  { key: 'basics', label: 'Basics group' },
  { key: 'more', label: 'More group' },
];

/** The served object: its own fields and groups, plus an internal form view. */
const PROJECT = {
  name: 'project',
  label: 'Project',
  fields: FIELDS,
  fieldGroups: FIELD_GROUPS,
  form: {
    type: 'simple',
    sections: [{ name: 'curated', label: 'Curated form section', fields: [{ field: 'summary' }] }],
  },
};

const dataSource = {
  getObjectSchema: async () => ({ name: 'project', label: 'Project', fields: FIELDS, fieldGroups: FIELD_GROUPS }),
  find: async () => ({ data: [], total: 0 }),
  findOne: async () => ({ id: 'p1', title: 'One' }),
};

const metadata: any = {
  apps: [], objects: [PROJECT], dashboards: [], reports: [], pages: [],
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

async function open(descriptor: Record<string, unknown>) {
  let handler: Handler | null = null;
  render(
    <MetadataCtx.Provider value={metadata}>
      <Harness onReady={(h) => { handler = h; }} />
    </MetadataCtx.Provider>,
  );
  await act(async () => {
    void handler!(descriptor);
  });
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('Title', undefined, { timeout: 5000 });
  return dialog;
}

describe('useActionModal reads no internal form view (#36425)', () => {
  it('a create lays out by the field groups: the form view\'s section is gone, its left-out field is back', async () => {
    const dialog = await open({ objectName: 'project', mode: 'create' });
    expect(within(dialog).getByText('Basics group')).toBeInTheDocument();
    expect(within(dialog).getByText('More group')).toBeInTheDocument();
    expect(within(dialog).queryByText('Curated form section')).toBeNull();
    expect(within(dialog).getByText('Secret Internal')).toBeInTheDocument();
  });

  it('a create leaves out a showOnCreate: false field', async () => {
    const dialog = await open({ objectName: 'project', mode: 'create' });
    expect(within(dialog).queryByText('Later Note')).toBeNull();
  });

  it('an edit shows the showOnCreate: false field', async () => {
    const dialog = await open({ objectName: 'project', mode: 'edit', recordId: 'p1' });
    expect(await within(dialog).findByText('Later Note', undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('CONTROL: a descriptor naming its own fields keeps them', async () => {
    const dialog = await open({ objectName: 'project', mode: 'create', fields: ['title'] });
    expect(within(dialog).queryByText('Summary')).toBeNull();
  });
});
