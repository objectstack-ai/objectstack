// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29077 — a read-only flow edge inspector says why its controls are
 * disabled, on hover, on keyboard focus and to assistive tech, when its host
 * hands it the reason (`readOnlyReason`), as the node inspector does since
 * objectstack#28985.
 *
 * Measured on the card: on a read-only package every control of the connection
 * inspector (From, To, the branch pickers, Label, Condition, Default branch,
 * Type, Remove connection) was disabled with no `aria-describedby` and no tab
 * stop, and the reason Studio's Automations pillar hands every flow inspector
 * was dropped. Both panels now draw it through one `InspectorReadOnlyReason`.
 *
 * The reason is the host's: a host that passes none gets the panel it always
 * had. Studio's pillar passing it to a selected connection is pinned in
 * `StudioDesignSurface.automationsReadOnly-11124.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowEdgeInspector } from './FlowEdgeInspector';
import { flowEdgeDisplayName } from '../previews/flow-canvas-parts';
import { t } from '../i18n';

afterEach(cleanup);

const REASON = 'Read-only package: switch to or create a writable package to edit.';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'review', type: 'approval', label: 'Review' },
  { id: 'end', type: 'end', label: 'End' },
];
// An approval's out-edge, so the panel also draws its "Approval branch" picker.
const DRAFT = {
  name: 'f',
  label: 'F',
  nodes: NODES,
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'end', label: 'approve' },
  ],
};

function mount({ readOnly, readOnlyReason }: { readOnly: boolean; readOnlyReason?: string }) {
  return render(
    <FlowEdgeInspector
      type="flow"
      name="f"
      draft={DRAFT}
      selection={{ kind: 'edge', id: 'e2' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      locale="en-US"
    />,
  );
}

const removeButton = () => screen.getByRole('button', { name: t('engine.inspector.flowEdge.remove', 'en-US') });

/** The panel's form controls, Remove connection included — the ones the reason is about. */
const controls = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('input, select, textarea, button[role="combobox"]'),
  removeButton(),
];

describe('Flow edge inspector, read-only with a reason from its host (objectstack#29077)', () => {
  it('the panel is a tab stop described by the reason, named by the connection, and holds the disabled controls', () => {
    const { container } = mount({ readOnly: true, readOnlyReason: REASON });
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body).toHaveAccessibleDescription(REASON);
    // The same name the panel's title shows: each end by its node's name.
    expect(body).toHaveAccessibleName(flowEdgeDisplayName({ source: 'review', target: 'end' }, NODES, 'en-US'));
    expect(body).not.toHaveAccessibleName(/review|end\b/);

    const all = controls(body);
    // From, To, Approval branch, Label, Condition, Default branch, Type and
    // Remove connection; at least six, so a vacuous pass is not one.
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) {
      expect(body).toContainElement(el);
      expect(el).toBeDisabled();
    }
  });

  it('hovering the disabled "Remove connection" opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount({ readOnly: true, readOnlyReason: REASON });
    expect(removeButton()).toBeDisabled();
    await user.hover(removeButton());
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

describe('Flow edge inspector — the controls (objectstack#29077)', () => {
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
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) expect(el).toBeEnabled();
  });
});
