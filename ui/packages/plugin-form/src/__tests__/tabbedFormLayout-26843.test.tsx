/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — a tabbed form keeps its authored
 * `layout: 'horizontal'`.
 *
 * `ObjectForm` hands the key to `TabbedForm` in its `{...schema}` spread, and
 * `TabbedForm` dropped it: the form node it builds said `layout: 'vertical'`
 * whatever the form view said. Now every field on every tab is drawn with its
 * label beside the control, the arrangement the form renderer gives
 * `horizontal` (pinned in its own `form-layout-horizontal-26843.test.tsx`).
 *
 * CONTROL: with no `layout` the tabbed form draws its fields vertical.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
// Registers the `form` renderer the tabbed form draws through, at module scope.
import '@object-ui/components';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT = {
  name: 'ticket',
  fields: { subject: { type: 'text', label: 'Subject' }, memo: { type: 'text', label: 'Memo' } },
};

const SECTIONS = [
  { name: 'main', label: 'Main', fields: ['subject'] },
  { name: 'more', label: 'More', fields: ['memo'] },
];

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn(),
    delete: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderTabbed(extra: Record<string, unknown>) {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'ticket',
        mode: 'create',
        formType: 'tabbed',
        sections: SECTIONS,
        ...extra,
      } as any}
      dataSource={dataSource}
    />,
  );
}

const item = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`);

async function drawn() {
  // Both tabs exist and both fields are mounted: the panels are force-mounted.
  await waitFor(() => expect(screen.queryByTestId('form-tab:more')).not.toBeNull());
  await waitFor(() => expect(item('memo')).not.toBeNull());
}

describe('a tabbed form keeps layout: horizontal (objectstack#26843)', () => {
  it('every field on every tab draws its label beside the control', async () => {
    renderTabbed({ layout: 'horizontal' });
    await drawn();
    for (const name of ['subject', 'memo']) {
      expect(item(name)!.className.split(/\s+/), name).toContain('sm:grid');
    }
  });

  it('CONTROL: no layout — the fields are drawn vertical', async () => {
    renderTabbed({});
    await drawn();
    for (const name of ['subject', 'memo']) {
      expect(item(name)!.className.split(/\s+/), name).not.toContain('sm:grid');
    }
  });

  it('CONTROL: layout vertical — the fields are drawn vertical', async () => {
    renderTabbed({ layout: 'vertical' });
    await drawn();
    expect(item('subject')!.className.split(/\s+/)).not.toContain('sm:grid');
  });
});
