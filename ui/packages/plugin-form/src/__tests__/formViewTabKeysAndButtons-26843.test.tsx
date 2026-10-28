/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — a tabbed form view's `defaultTab` /
 * `tabPosition`, and the cancel button's visibility, on the arms that dropped
 * them.
 *
 *   - A tabbed form WITH subforms renders through `MasterDetailForm`, whose
 *     header form `ObjectForm` rebuilt key by key without the tab keys, so it
 *     opened on its first tab with the strip on top whatever the view said.
 *   - `ModalForm`'s tabbed content layout read neither key, and its subforms
 *     arm passed no `formType` at all, so a tabbed modal with subforms opened
 *     stacked.
 *   - The master-detail action bar draws Cancel whenever it is handed an
 *     `onCancel`, and both arms handed one whatever `showCancel` said.
 *
 * Each case has a CONTROL with the key absent, which keeps today's answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';

vi.mock('@object-ui/components', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});

registerAllFields();

const parentObject = {
  name: 'po',
  fields: { ref: { type: 'text', label: 'Ref' }, memo: { type: 'text', label: 'Memo' } },
};

const SECTIONS = [
  { name: 's1', label: 'Sec One', fields: ['ref'] },
  { name: 's2', label: 'Sec Two', fields: ['memo'] },
];

const SUBFORMS = [
  {
    childObject: 'po_line',
    relationshipField: 'po',
    columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
  },
];

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(parentObject),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'po1' }),
    update: vi.fn().mockResolvedValue({ id: 'po1' }),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const trigger = (key: string) => screen.queryByTestId(`form-tab:${key}`);

async function tabsDrawn() {
  await waitFor(() => expect(trigger('s1')).not.toBeNull());
}

function renderObjectForm(extra: Record<string, unknown>) {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'po',
        mode: 'create',
        formType: 'tabbed',
        sections: SECTIONS,
        subforms: SUBFORMS,
        onCancel: () => {},
        ...extra,
      } as any}
      dataSource={dataSource}
    />,
  );
}

function renderModalForm(extra: Record<string, unknown>) {
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'po',
        mode: 'create',
        open: true,
        contentLayout: 'tabbed',
        sections: SECTIONS,
        ...extra,
      } as any}
      dataSource={dataSource}
    />,
  );
}

describe('a tabbed form with subforms opens on its declared tab (ObjectForm → MasterDetailForm)', () => {
  it('defaultTab selects the tab and tabPosition places the strip', async () => {
    renderObjectForm({ defaultTab: 's2', tabPosition: 'left' });
    await tabsDrawn();

    expect(trigger('s2')).toHaveAttribute('data-state', 'active');
    expect(trigger('s1')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('CONTROL: neither key — the first tab, the strip on top', async () => {
    renderObjectForm({});
    await tabsDrawn();

    expect(trigger('s1')).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
  });
});

describe('the modal tabbed layout honours the tab keys, with and without subforms', () => {
  it('flat: defaultTab selects the tab and tabPosition places the strip', async () => {
    renderModalForm({ defaultTab: 's2', tabPosition: 'right' });
    await tabsDrawn();

    expect(trigger('s2')).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('subforms: the header form is tabbed and opens on defaultTab', async () => {
    renderModalForm({ defaultTab: 's2', subforms: SUBFORMS });
    await tabsDrawn();

    expect(trigger('s2')).toHaveAttribute('data-state', 'active');
  });

  it('CONTROL: subforms with no contentLayout stay stacked — no tab strip', async () => {
    renderModalForm({ contentLayout: undefined, subforms: SUBFORMS });
    await waitFor(() => expect(screen.getByText('Sec Two')).toBeInTheDocument());

    expect(trigger('s1')).toBeNull();
  });
});

describe('the master-detail action bar draws Cancel only when it is shown', () => {
  it('ObjectForm: showCancel false removes Cancel and keeps Save', async () => {
    renderObjectForm({ showCancel: false });
    await tabsDrawn();

    expect(screen.queryByTestId('md-form-cancel')).toBeNull();
    expect(screen.getByTestId('md-form-submit')).toBeInTheDocument();
  });

  it('ObjectForm CONTROL: showCancel unset keeps Cancel', async () => {
    renderObjectForm({});
    await tabsDrawn();

    expect(screen.getByTestId('md-form-cancel')).toBeInTheDocument();
  });

  it('ModalForm: showCancel false removes Cancel; showSubmit false removes the Save bar', async () => {
    renderModalForm({ subforms: SUBFORMS, showCancel: false });
    await tabsDrawn();
    expect(screen.queryByTestId('md-form-cancel')).toBeNull();
    expect(screen.getByTestId('md-form-submit')).toBeInTheDocument();

    cleanup();
    renderModalForm({ subforms: SUBFORMS, showSubmit: false });
    await tabsDrawn();
    expect(screen.queryByTestId('md-form-submit')).toBeNull();
  });

  it('ModalForm CONTROL: neither flag — Cancel and Save both drawn', async () => {
    renderModalForm({ subforms: SUBFORMS });
    await tabsDrawn();

    expect(screen.getByTestId('md-form-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('md-form-submit')).toBeInTheDocument();
  });
});
