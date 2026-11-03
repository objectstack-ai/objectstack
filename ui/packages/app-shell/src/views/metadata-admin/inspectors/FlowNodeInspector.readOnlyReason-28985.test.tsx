// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28985 — a read-only flow node inspector says why its controls are
 * disabled, on hover, on keyboard focus and to assistive tech, when its host
 * hands it the reason (`readOnlyReason`).
 *
 * Measured on the card: on a read-only package every control of the node
 * inspector (ID, Label, Node Type, the config fields, Remove node) was disabled
 * with no `title`, no `aria-describedby` and no tab stop, so nothing said why.
 * The inspector body now carries the treatment Studio's field rail and
 * validation-rule editor carry: a tab stop described by an `sr-only` copy of
 * the reason, and the trigger of a tooltip that shows it.
 *
 * The reason is the host's: the inspector is shared by hosts whose read-only
 * causes differ, so a host that passes none gets the panel it always had.
 * Studio's Automations pillar passing the package's reason is pinned in
 * `StudioDesignSurface.automationsReadOnly-11124.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { t } from '../i18n';

afterEach(cleanup);

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

const REASON = 'Read-only package: switch to or create a writable package to edit.';

const DRAFT = {
  name: 'f',
  label: 'F',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'set_status',
      type: 'update_record',
      label: 'Set status',
      config: { objectName: 'task', fields: { status: 'done' } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'set_status' },
    { id: 'e2', source: 'set_status', target: 'end' },
  ],
};

function mount({ readOnly, readOnlyReason }: { readOnly: boolean; readOnlyReason?: string }) {
  return render(
    <FlowNodeInspector
      type="flow"
      name="f"
      draft={DRAFT}
      selection={{ kind: 'node', id: 'set_status', label: 'Set status' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      locale="en-US"
    />,
  );
}

/** The panel's form controls, Remove node included — the ones the reason is about. */
const controls = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('input, select, textarea, button[role="combobox"]'),
  screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') }),
];

describe('Flow node inspector, read-only with a reason from its host (objectstack#28985)', () => {
  it('the panel is a tab stop described by the reason, named by the node, and holds the disabled controls', () => {
    const { container } = mount({ readOnly: true, readOnlyReason: REASON });
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body).toHaveAccessibleDescription(REASON);
    expect(body).toHaveAccessibleName('Set status');

    const all = controls(body);
    // ID, Label, Node Type and Remove node alone are four; a vacuous pass is not one.
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const el of all) {
      expect(body).toContainElement(el);
      expect(el).toBeDisabled();
    }
  });

  it('hovering the disabled "Remove node" opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount({ readOnly: true, readOnlyReason: REASON });
    const remove = screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') });
    expect(remove).toBeDisabled();
    await user.hover(remove);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('a keyboard user reaches the reason: Tab lands on the described panel, which opens the tooltip', async () => {
    const user = userEvent.setup();
    const { container } = mount({ readOnly: true, readOnlyReason: REASON });
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    await user.tab();
    expect(body).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });
});

describe('Flow node inspector — the controls (objectstack#28985)', () => {
  it('a host that passes no reason gets the panel it always had: no tab stop, no description', () => {
    const { container } = mount({ readOnly: true });
    expect(container.querySelector('[data-disabled-reason]')).toBeNull();
    expect(container.querySelector('[tabindex="0"]')).toBeNull();
    for (const el of controls(container)) expect(el).toBeDisabled();
  });

  it('a blank reason counts as none', () => {
    const { container } = mount({ readOnly: true, readOnlyReason: '  ' });
    expect(container.querySelector('[data-disabled-reason]')).toBeNull();
  });

  it('a writable inspector ignores a reason: the controls are live and nothing is described', () => {
    const { container } = mount({ readOnly: false, readOnlyReason: REASON });
    expect(container.querySelector('[data-disabled-reason]')).toBeNull();
    expect(screen.queryByText(REASON)).toBeNull();
    const all = controls(container);
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const el of all) expect(el).toBeEnabled();
  });
});
