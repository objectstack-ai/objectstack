/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PeoplePicker draws only the subtitle fields and the avatar the user may
 * read — objectui#10433.
 *
 * Under the renderer-side FLS rulings (objectui#7215 / objectui#7230) field-level
 * security gates the OUTPUT. objectui#10373 gated PeoplePicker's `$expand`, and
 * only that: a person row still drew every `subtitleFields` path and the avatar
 * straight off the served row, and the selection tray drew the same avatar, so
 * on a backend that does not strip denied keys (ObjectStack's `FieldMasker`
 * does) a plain field such as `email` showed under a policy that denies it.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub), on the
 * object the picker queries (`sys_user`):
 *
 *  - a person row shows neither a denied subtitle field nor a denied avatar,
 *    and the row can still be chosen; the readable subtitle field still shows
 *    (the pin reads a FILTER, not a subtitle that vanished);
 *  - the avatar is judged by the field the picker is configured with, not by a
 *    literal `image`;
 *  - a subtitle path through a denied relation is not drawn even when the
 *    backend expands that relation anyway;
 *  - the selection tray's avatar obeys the same policy;
 *  - with the policy open, or with no policy loaded (no provider: `isLoaded`
 *    is false), everything is drawn as before.
 *
 * happy-dom never loads an image, so Radix's `AvatarImage` renders no `img`
 * whether or not a URL reached it, and a "no img" assertion would pass on the
 * defect too. `LoadedImage` reports every image as loaded, so an `img` renders
 * exactly when an avatar URL reached the Avatar; each control below asserts
 * that `img`, which is what lets the denial legs fail.
 */

import * as React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionProvider } from '@object-ui/permissions';
import { PeoplePicker } from './PeoplePicker';

const AMY = {
  id: 'u1',
  name: 'Amy Lin',
  email: 'amy@x.io',
  phone: '555-0100',
  image: 'http://x/amy.png',
  photo: 'http://x/amy-photo.png',
  primary_business_unit_id: 'bu_1',
};
const BUSINESS_UNITS: Record<string, { id: string; name: string }> = {
  bu_1: { id: 'bu_1', name: 'Sales' },
};

/**
 * A backend that does NOT strip denied keys. By default it honours `$expand`;
 * `alwaysExpand` makes it resolve the relation whether or not it was asked to.
 */
function makeDataSource({ alwaysExpand = false }: { alwaysExpand?: boolean } = {}) {
  const find = vi.fn(async (_obj: string, params: any) => {
    const expand: string[] = Array.isArray(params?.$expand) ? params.$expand : [];
    const expandUnit = alwaysExpand || expand.includes('primary_business_unit_id');
    const data = [AMY].map((u) => ({
      ...u,
      ...(expandUnit ? { primary_business_unit_id: BUSINESS_UNITS[u.primary_business_unit_id] } : {}),
    }));
    return { data, total: data.length };
  });
  return { find } as any;
}

type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

/** The real role-based provider, denying the named `sys_user` fields to `viewer`. */
function denying(...fields: string[]): Wrap {
  return (node) => (
    <PermissionProvider
      roles={[]}
      userRoles={['viewer']}
      permissions={[
        {
          object: 'sys_user',
          roles: {
            viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
          },
        },
      ]}
    >
      {node}
    </PermissionProvider>
  );
}

async function mount(wrap: Wrap, extra: Record<string, unknown> = {}, ds = makeDataSource()) {
  const onSelect = vi.fn();
  render(
    wrap(
      <PeoplePicker
        open
        objectName="sys_user"
        subtitleFields={['phone', 'email']}
        dataSource={ds}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
        {...extra}
      />,
    ),
  );
  await waitFor(() => expect(screen.getByTestId('person-row')).toBeTruthy());
  return { onSelect, row: screen.getByTestId('person-row') };
}

/** The `src` of the avatar `img` inside `el`, or `null` when none is drawn. */
function avatarSrc(el: HTMLElement): string | null {
  return el.querySelector('img')?.getAttribute('src') ?? null;
}

/** Reports every image as loaded, so Radix's `AvatarImage` renders its `img`. */
class LoadedImage {
  complete = true;
  naturalWidth = 1;
  src = '';
  crossOrigin: string | null = null;
  referrerPolicy = '';
  addEventListener(): void {}
  removeEventListener(): void {}
}

let realImage: typeof window.Image;

beforeEach(() => {
  // No matchMedia in happy-dom; useIsMobile needs it. Default to desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  realImage = window.Image;
  (window as any).Image = LoadedImage;
});

afterEach(() => {
  cleanup();
  (window as any).Image = realImage;
});

describe('PeoplePicker — field-level security gates the drawn subtitle and avatar (objectui#10433)', () => {
  it('a person row shows neither a denied subtitle field nor a denied avatar, and can still be chosen', async () => {
    const { row, onSelect } = await mount(denying('email', 'image'));

    expect(row.textContent).toContain('555-0100');
    expect(row.textContent).not.toContain('amy@x.io');
    expect(avatarSrc(row)).toBeNull();
    // The initials fallback stands in for the withheld image.
    expect(within(row).getByText('AL')).toBeTruthy();

    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('u1');
  });

  it('the avatar is judged by the configured avatar field, not by a literal `image`', async () => {
    const denied = await mount(denying('photo'), { avatarField: 'photo' });
    expect(avatarSrc(denied.row)).toBeNull();
    cleanup();

    const readable = await mount(denying('image'), { avatarField: 'photo' });
    expect(avatarSrc(readable.row)).toBe('http://x/amy-photo.png');
  });

  it('a subtitle path through a denied relation is not drawn, even when the backend expands it anyway', async () => {
    const { row } = await mount(
      denying('primary_business_unit_id'),
      { subtitleFields: ['primary_business_unit_id.name', 'email'] },
      makeDataSource({ alwaysExpand: true }),
    );

    expect(row.textContent).toContain('amy@x.io');
    expect(row.textContent).not.toContain('Sales');
  });

  it("the selection tray's avatar obeys the same policy", async () => {
    await mount(denying('image'), { multiple: true, value: ['u1'] });
    await waitFor(() => expect(screen.getByTestId('selection-chip')).toBeTruthy());

    expect(avatarSrc(screen.getByTestId('selection-chip'))).toBeNull();
    expect(within(screen.getByTestId('selection-chip')).getByText('Amy Lin')).toBeTruthy();
  });

  it('control: with the policy open, the row and the tray draw the subtitle and the avatar', async () => {
    const { row } = await mount(denying('secret_note'), { multiple: true, value: ['u1'] });
    await waitFor(() => expect(screen.getByTestId('selection-chip')).toBeTruthy());

    expect(row.textContent).toContain('555-0100 · amy@x.io');
    expect(avatarSrc(row)).toBe('http://x/amy.png');
    expect(avatarSrc(screen.getByTestId('selection-chip'))).toBe('http://x/amy.png');
  });

  it('control: with no policy loaded (no provider) nothing is withheld', async () => {
    const { row } = await mount(bare, {
      subtitleFields: ['primary_business_unit_id.name', 'email'],
    });

    expect(row.textContent).toContain('Sales · amy@x.io');
    expect(avatarSrc(row)).toBe('http://x/amy.png');
  });
});
