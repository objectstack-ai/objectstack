/**
 * element:button with a `mailto:` url target opens the mail client in place
 * (objectui#12191, ruling A+).
 *
 * The spec accepts `{ actionType: 'url', target: 'mailto:…' }` on an
 * `element:button`, and the button hands it to the shared ActionRunner. The
 * runner refused every scheme but http(s), so the button published cleanly and
 * then answered an error at click. Cloud's "contact us" button
 * (`CONTACT_SALES_URL`, `mailto:sales@objectos.ai`) is the first producer.
 *
 * Pinned here through the real button and the real runner, because the button
 * is the authoring surface: it navigates IN PLACE, even with
 * `openIn: 'new-tab'`, and never through the app's router. A `tel:` target is
 * still refused. The runner-level pins are in
 * `packages/core/src/actions/__tests__/navigationTarget.mailto-12191.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import '../renderers/basic/elements';

function ElementButton({ schema }: { schema: Record<string, unknown> }) {
  const C = ComponentRegistry.get('element:button');
  if (!C) throw new Error('element:button not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <C schema={schema} />;
}

const MAIL = 'mailto:sales@objectos.ai';

let originalLocation: Location;
let hrefSet: Mock<(url: string) => void>;
let openSpy: MockInstance<typeof window.open>;

beforeEach(() => {
  originalLocation = window.location;
  hrefSet = vi.fn();
  Object.defineProperty(window, 'location', {
    writable: true,
    // Only the setter matters: the runner assigns `window.location.href`.
    value: { ...originalLocation, set href(v: string) { hrefSet(v); } } as unknown as Location,
  });
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
  Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
});

function renderButton(action: Record<string, unknown>) {
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <ElementButton schema={{ type: 'element:button', properties: { label: 'Contact us', action } }} />
    </ActionProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Contact us/i }));
  return { onNavigate, onToast };
}

describe('element:button — a mailto: url target (objectui#12191)', () => {
  it('opens the mail client in place, not through the router', async () => {
    const { onNavigate } = renderButton({ actionType: 'url', target: MAIL });
    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith(MAIL));
    expect(hrefSet).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("stays in place with openIn: 'new-tab': openIn is not consulted", async () => {
    const { onNavigate } = renderButton({ actionType: 'url', target: MAIL, openIn: 'new-tab' });
    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith(MAIL));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: an in-app path still goes through the router', async () => {
    const { onNavigate } = renderButton({ actionType: 'url', target: '/apps/cloud_control/sys_environment' });
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith('/apps/cloud_control/sys_environment', expect.anything()),
    );
    expect(hrefSet).not.toHaveBeenCalled();
  });

  it('still refuses tel:, with the error that names the admitted set', async () => {
    const { onNavigate, onToast } = renderButton({ actionType: 'url', target: 'tel:+1' });
    // The runner has answered once its error toast is up.
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining('mailto:'), expect.objectContaining({ type: 'error' })),
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(hrefSet).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
