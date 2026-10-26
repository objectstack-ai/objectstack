/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A search-first (people) lookup's selected-value chip draws its avatar only
 * from a field the user may read — objectui#10433.
 *
 * Under the renderer-side FLS rulings (objectui#7215 / objectui#7230) field-level
 * security gates the OUTPUT. objectui#10373 built the option LABEL from the row
 * with the denied fields removed, but the option still carries the row as
 * served, and the chip read its avatar straight off it — the configured avatar
 * field, then `image` as a fallback — so on a backend that does not strip
 * denied keys (ObjectStack's `FieldMasker` does) a denied avatar was drawn.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub), on the
 * referenced object (`sys_user`, which `UserField` targets):
 *
 *  - a denied avatar field is not drawn; the chip, its label and its initials
 *    stay;
 *  - the `image` fallback is judged too: it is a field of the served row, so a
 *    denied `image` is not drawn in place of a denied avatar field, while a
 *    readable one still stands in for it;
 *  - with the policy open, or with no policy loaded (no provider: `isLoaded`
 *    is false), the avatar is drawn as before.
 *
 * happy-dom never loads an image, so Radix's `AvatarImage` renders no `img`
 * whether or not a URL reached it. `LoadedImage` reports every image as loaded,
 * so an `img` renders exactly when an avatar URL reached the Avatar; each
 * control below asserts that `img`, which is what lets the denial legs fail.
 */

import * as React from 'react';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionProvider } from '@object-ui/permissions';
import { UserField } from './UserField';

const AMY = {
  id: 'u1',
  name: 'Amy Lin',
  email: 'amy@x.io',
  image: 'http://x/amy.png',
  photo: 'http://x/amy-photo.png',
};

/** A backend that does NOT strip denied keys. */
function makeDataSource() {
  const find = vi.fn(async (_obj: string, params: any = {}) => {
    const idIn = params?.$filter?.id?.$in as any[] | undefined;
    const data = idIn ? [AMY].filter((u) => idIn.map(String).includes(u.id)) : [AMY];
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

/** Mount a multi-value user field holding `u1`; resolves to its chip. */
async function chip(wrap: Wrap, meta: Record<string, unknown> = {}): Promise<HTMLElement> {
  render(
    wrap(
      <UserField
        field={{ type: 'user', multiple: true, ...meta } as any}
        dataSource={makeDataSource()}
        value={['u1']}
        onChange={vi.fn()}
      />,
    ),
  );
  await waitFor(() => expect(screen.getByTestId('people-field-chip')).toBeTruthy());
  return screen.getByTestId('people-field-chip');
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

describe('LookupField search-variant chip — field-level security gates the avatar (objectui#10433)', () => {
  it('a denied avatar field is not drawn; the chip, its label and its initials stay', async () => {
    const el = await chip(denying('image'));

    expect(avatarSrc(el)).toBeNull();
    expect(within(el).getByText('Amy Lin')).toBeTruthy();
    expect(within(el).getByText('AL')).toBeTruthy();
  });

  it('the `image` fallback is judged too: denied, it does not stand in for a denied avatar field', async () => {
    const el = await chip(denying('photo', 'image'), { avatar_field: 'photo' });

    expect(avatarSrc(el)).toBeNull();
  });

  it('a readable `image` still stands in for a denied avatar field', async () => {
    const el = await chip(denying('photo'), { avatar_field: 'photo' });

    expect(avatarSrc(el)).toBe('http://x/amy.png');
  });

  it('control: with the policy open, the configured avatar field is drawn', async () => {
    const el = await chip(denying('email'), { avatar_field: 'photo' });

    expect(avatarSrc(el)).toBe('http://x/amy-photo.png');
  });

  it('control: with no policy loaded (no provider) the avatar is drawn', async () => {
    const el = await chip(bare);

    expect(avatarSrc(el)).toBe('http://x/amy.png');
  });
});
