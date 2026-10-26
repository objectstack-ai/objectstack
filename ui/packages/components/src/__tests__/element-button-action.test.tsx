/**
 * element:button — action onClick.
 *
 * A standalone-page button was inert: the renderer ignored its action/events,
 * so a metadata-defined "Upgrade" CTA could not navigate or invoke a route.
 * These tests cover the new `properties.action` wiring (executed via the shared
 * ActionRunner) plus the back-compat path (no action → inert, no crash).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import '../renderers/basic/elements';

function ElementButton({ schema }: { schema: any }) {
  const C = ComponentRegistry.get('element:button');
  if (!C) throw new Error('element:button not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <C schema={schema} />;
}

describe('element:button — action onClick', () => {
  it('executes a navigation action on click (drives the navigation handler)', async () => {
    const onNavigate = vi.fn();
    render(
      <ActionProvider onNavigate={onNavigate}>
        <ElementButton
          schema={{
            type: 'element:button',
            properties: {
              label: 'Upgrade',
              action: { type: 'navigation', to: '/apps/cloud_control/sys_environment' },
            },
          }}
        />
      </ActionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Upgrade/i }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        '/apps/cloud_control/sys_environment',
        expect.anything(),
      ),
    );
  });

  it('renders inert without an action — no onClick, no crash (back-compat)', () => {
    render(
      <ElementButton schema={{ type: 'element:button', properties: { label: 'Static' } }} />,
    );
    const btn = screen.getByRole('button', { name: /Static/i });
    expect(btn).toBeTruthy();
    // Must not throw even with no ActionProvider mounted.
    fireEvent.click(btn);
  });

  it('renders as type=button so it never submits a surrounding form', () => {
    render(
      <ElementButton schema={{ type: 'element:button', properties: { label: 'Safe' } }} />,
    );
    expect(screen.getByRole('button', { name: /Safe/i }).getAttribute('type')).toBe('button');
  });
});
