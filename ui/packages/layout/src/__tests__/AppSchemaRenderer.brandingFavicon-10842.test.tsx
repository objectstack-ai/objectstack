/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AppSchemaRenderer` puts the app favicon from `branding.favicon` on the tab
 * (objectui#10842).
 *
 * It used to hand `AppShell` the top-level `favicon`, a second spelling that
 * `@objectstack/spec`'s `AppSchema` refuses, and never read `branding.favicon`,
 * the spelling the console reads and every designer writes. The icon link is
 * the one `AppShell`'s `useAppShellBranding` writes to (`#favicon`).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppComponentSchema } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';

const SHIPPED = '/shipped.svg';
let link: HTMLLinkElement;

beforeEach(() => {
  link = document.createElement('link');
  link.id = 'favicon';
  link.rel = 'icon';
  link.setAttribute('href', SHIPPED);
  document.head.appendChild(link);
});
afterEach(() => {
  cleanup();
  link.remove();
});

const BASE: AppComponentSchema = { type: 'app', name: 'acme_crm', title: 'Acme CRM' };

function iconHrefWith(schema: AppComponentSchema): string | null {
  render(
    <MemoryRouter>
      <AppSchemaRenderer schema={schema} basePath="/apps/acme_crm">
        <div>page</div>
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  return link.getAttribute('href');
}

describe('AppSchemaRenderer reads the favicon from `branding.favicon` (objectui#10842)', () => {
  it('puts `branding.favicon` on the icon link', () => {
    expect(iconHrefWith({ ...BASE, branding: { favicon: '/acme.ico' } })).toContain('/acme.ico');
  });

  it('CONTROL — an app with no favicon leaves the shipped icon alone', () => {
    expect(iconHrefWith(BASE)).toBe(SHIPPED);
  });

  it('the retired top-level `favicon` is not read', () => {
    // Cast past the type, as a stale document handed straight to the renderer
    // would be: the key is `never` on the TS face and refused by the mirror.
    const stale = { ...BASE, favicon: '/stale.ico' } as unknown as AppComponentSchema;
    expect(iconHrefWith(stale)).toBe(SHIPPED);
  });
});
