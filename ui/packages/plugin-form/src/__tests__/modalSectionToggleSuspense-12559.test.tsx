/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12559 — expanding a collapsed section of the console's record
 * dialog must open it IN PLACE.
 *
 * THE PRODUCER. The field widgets `@object-ui/fields` registers are
 * `React.lazy`: a type's chunk is fetched the first time a form draws it. A
 * section that starts collapsed holds its fields out of the DOM, so the click
 * that opens it is often the first render of a type (`currency`, `url`,
 * `address`…). Nothing inside the dialog caught that suspension, so it left
 * `ModalForm` and landed on the HOST's nearest `<Suspense>`. The console mounts
 * the record dialog beside its routes, under the shell's root boundary, with no
 * route boundary in between — so the whole console, dialog included, was
 * swapped for the root fallback while the chunk loaded. The full-page form hid
 * only its page: its nearest boundary is the route's. The fix is a boundary
 * around the dialog's body (`ModalFormBodyPending` in `ModalForm.tsx`).
 *
 * Since objectui#13246 the toggle itself is a transition, so a header click
 * keeps the drawn body on screen and reaches neither boundary: hiding the body
 * hid the focused header too (`sectionOpenKeepsFocus-13246.test.tsx`). The
 * dialog's boundary still owns every wait an ordinary update starts; the last
 * case below pins it on the body's first draw.
 *
 * NOT the producer, read off the code: the collapse state lives in
 * `ModalForm`'s own `useState` (not above the dialog's key), and the console's
 * key for the dialog is the object name plus the record id or `new`, which a
 * toggle cannot change.
 *
 * THE HOST HERE is the console's shape: a root `<Suspense>` whose fallback
 * counts its mounts, a host component that mints a mount id once, and the
 * dialog under a stable key, handed a FRESH schema object on every render as
 * `AppContent` hands it. The `url` widget is replaced by one whose chunk
 * resolves only when the test releases it, so the suspension is observable
 * mid-flight instead of racing the module loader.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React, { Suspense, useState } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

/** Replace the `url` widget with one whose chunk lands only on `release()`. */
function deferUrlWidget(): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const Deferred = React.lazy(async () => {
    await gate;
    return {
      default: (props: { id?: string; value?: unknown; onChange?: (v: unknown) => void }) => (
        <input
          data-testid="deferred-url-widget"
          id={props.id}
          value={(props.value as string) ?? ''}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      ),
    };
  });
  ComponentRegistry.register('url', Deferred, { namespace: 'field', skipFallback: true });
  return { release: () => act(() => release()) as unknown as void };
}

const LEAD = {
  name: 'lead',
  fields: {
    first_name: { type: 'text', label: 'First Name' },
    company: { type: 'text', label: 'Company' },
    website: { type: 'url', label: 'Website' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(LEAD),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn(),
  }) as any;

const SECTIONS = (company: Record<string, unknown>) => [
  { name: 'basic', label: 'Basic', fields: ['first_name'] },
  { name: 'company_info', label: 'Company Information', ...company, fields: ['company', 'website'] },
];

/** The console's mount, reduced: root boundary → host → keyed dialog. */
function mountConsoleShaped(ds: any, company: Record<string, unknown>) {
  const counts = { hostFallbackMounts: 0, hostMounts: 0 };
  const handle = { rerender: () => {} };
  function HostFallback() {
    React.useEffect(() => { counts.hostFallbackMounts++; }, []);
    return <div data-testid="host-fallback">loading</div>;
  }
  function Host() {
    const [mountId] = useState(() => ++counts.hostMounts);
    const [, setTick] = useState(0);
    React.useEffect(() => {
      handle.rerender = () => act(() => setTick((n) => n + 1));
    }, []);
    return (
      <div data-testid="host-mount-id" data-mount={mountId}>
        <ModalForm
          key="lead:new"
          // A fresh object every render, as `AppContent` builds it.
          schema={{
            type: 'object-form',
            formType: 'modal',
            objectName: 'lead',
            mode: 'create',
            open: true,
            title: 'Create Lead',
            sections: SECTIONS(company),
          } as any}
          dataSource={ds}
        />
      </div>
    );
  }
  render(
    <Suspense fallback={<HostFallback />}>
      <Host />
    </Suspense>,
  );
  return { counts, rerenderHost: () => handle.rerender() };
}

const sectionHeader = (label: string) =>
  [...document.body.querySelectorAll('[role="button"][aria-expanded]')].find((el) =>
    el.textContent?.includes(label),
  ) as HTMLElement | undefined;

const drawnFields = () =>
  [...document.body.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'));

const firstNameInput = () =>
  document.body.querySelector('[data-field="first_name"] input') as HTMLInputElement | null;

/** Whether React's Suspense hiding has taken the dialog off screen. */
const dialogShown = () => {
  const dialog = screen.queryByRole('dialog');
  return !!dialog && dialog.style.display !== 'none';
};

async function formReady() {
  await waitFor(() => expect(firstNameInput()).not.toBeNull());
}

describe('ModalForm — a collapsed section opens in place (objectui#12559)', () => {
  it('a header click expands the section with no host fallback, no remount, and the typed value kept', async () => {
    const { release } = deferUrlWidget();
    const ds = makeDataSource();
    const { counts } = mountConsoleShaped(ds, { collapsed: true });
    await formReady();

    fireEvent.change(firstNameInput()!, { target: { value: 'Ada' } });
    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('false');
    expect(drawnFields()).not.toContain('website');
    const fallbacksBefore = counts.hostFallbackMounts;

    fireEvent.click(sectionHeader('Company Information')!);

    // Mid-load: nothing above the dialog waits, and since objectui#13246 its
    // body does not either — the toggle is a transition, so the drawn body,
    // typed value included, stays on screen until the section can be drawn.
    expect(counts.hostFallbackMounts).toBe(fallbacksBefore);
    expect(screen.queryByTestId('host-fallback')).toBeNull();
    expect(dialogShown()).toBe(true);
    expect(screen.getByRole('dialog').textContent).toContain('Create Lead');
    expect(screen.getByRole('dialog').querySelector('[data-testid="modal-form-body-pending"]')).toBeNull();
    expect(firstNameInput()!.closest('[style*="display: none"]')).toBeNull();

    release();
    await screen.findByTestId('deferred-url-widget');

    // The same mount throughout: one host mount, one schema read, the value kept.
    expect(counts.hostFallbackMounts).toBe(fallbacksBefore);
    expect(counts.hostMounts).toBe(1);
    expect(ds.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('modal-form-skeleton')).toBeNull();
    expect(screen.queryByTestId('modal-form-body-pending')).toBeNull();
    expect(firstNameInput()!.value).toBe('Ada');
    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('true');
    expect(drawnFields()).toEqual(expect.arrayContaining(['company', 'website']));
  });

  it('the toggled state is owned by the dialog: a host re-render with a fresh schema keeps the section open', async () => {
    const { release } = deferUrlWidget();
    release();
    const ds = makeDataSource();
    const { rerenderHost } = mountConsoleShaped(ds, { collapsed: true });
    await formReady();

    fireEvent.click(sectionHeader('Company Information')!);
    await screen.findByTestId('deferred-url-widget');
    rerenderHost();

    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('true');
    expect(drawnFields()).toContain('website');
  });

  it('control: a section that starts expanded still collapses on a header click', async () => {
    const { release } = deferUrlWidget();
    release();
    const ds = makeDataSource();
    mountConsoleShaped(ds, { collapsible: true });
    await formReady();
    await screen.findByTestId('deferred-url-widget');
    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(sectionHeader('Company Information')!);

    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('false');
    expect(drawnFields()).not.toContain('website');
  });

  it('the dialog still owns the wait of an ordinary update: the body\'s first draw waits inside the dialog', async () => {
    const { release } = deferUrlWidget();
    const ds = makeDataSource();
    // Open from the start, so the first draw after the load renders `website`.
    const { counts } = mountConsoleShaped(ds, {});

    await waitFor(() =>
      expect(screen.getByRole('dialog').querySelector('[data-testid="modal-form-body-pending"]')).not.toBeNull(),
    );
    expect(counts.hostFallbackMounts).toBe(0);
    expect(screen.queryByTestId('host-fallback')).toBeNull();
    expect(dialogShown()).toBe(true);

    release();
    await screen.findByTestId('deferred-url-widget');
    expect(screen.queryByTestId('modal-form-body-pending')).toBeNull();
    expect(counts.hostFallbackMounts).toBe(0);
    expect(counts.hostMounts).toBe(1);
  });

  it('control: the full-page form (ObjectForm, simple) still expands a collapsed section', async () => {
    const { release } = deferUrlWidget();
    const ds = makeDataSource();
    render(
      <Suspense fallback={<div data-testid="route-fallback">loading</div>}>
        <ObjectForm
          schema={{
            type: 'object-form',
            formType: 'simple',
            objectName: 'lead',
            mode: 'create',
            sections: SECTIONS({ collapsed: true }),
          } as any}
          dataSource={ds}
        />
      </Suspense>,
    );
    await formReady();
    expect(drawnFields()).not.toContain('website');

    fireEvent.click(sectionHeader('Company Information')!);
    release();

    await screen.findByTestId('deferred-url-widget');
    expect(sectionHeader('Company Information')?.getAttribute('aria-expanded')).toBe('true');
    expect(drawnFields()).toEqual(expect.arrayContaining(['company', 'website']));
  });
});
