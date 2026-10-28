/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27224 — a wizard form keeps its authored
 * `layout: 'horizontal'`.
 *
 * `ObjectForm` hands the key to `WizardForm` in its `{...schema}` spread, and
 * `WizardForm` dropped it: the step form node it builds said
 * `layout: 'vertical'` whatever the form view said, the shape `TabbedForm` had
 * before objectstack-ai/objectstack#26843. Now every field on every step is
 * drawn with its label beside the control, the arrangement the form renderer
 * gives `horizontal` (pinned in its own `form-layout-horizontal-26843.test.tsx`).
 *
 * CONTROL: with no `layout`, and with `vertical`, the wizard draws its fields
 * vertical.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
// Registers the `form` renderer the wizard draws each step through, at module scope.
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

function renderWizard(extra: Record<string, unknown>) {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'ticket',
        mode: 'create',
        formType: 'wizard',
        sections: SECTIONS,
        ...extra,
      } as any}
      dataSource={dataSource}
    />,
  );
}

const item = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`);
const classesOf = (name: string) => item(name)!.className.split(/\s+/);

/** Draws step one, then moves to step two with Next. */
async function walkBothSteps(onStep: (name: string) => void) {
  await waitFor(() => expect(item('subject')).not.toBeNull());
  onStep('subject');
  await userEvent.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => expect(item('memo')).not.toBeNull());
  onStep('memo');
}

describe('a wizard form keeps layout: horizontal (objectstack#27224)', () => {
  it('every field on every step draws its label beside the control', async () => {
    renderWizard({ layout: 'horizontal' });
    await walkBothSteps((name) => expect(classesOf(name), name).toContain('sm:grid'));
  });

  it('CONTROL: no layout — the fields on every step are drawn vertical', async () => {
    renderWizard({});
    await walkBothSteps((name) => expect(classesOf(name), name).not.toContain('sm:grid'));
  });

  it('CONTROL: layout vertical — the fields are drawn vertical', async () => {
    renderWizard({ layout: 'vertical' });
    await waitFor(() => expect(item('subject')).not.toBeNull());
    expect(classesOf('subject')).not.toContain('sm:grid');
  });
});
