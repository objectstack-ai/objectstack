/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AppSchemaRenderer`'s default sidebar header draws the app logo from
 * `branding.logo` (objectui#10827).
 *
 * Before, the header read a top-level `logo` — a second spelling that
 * `@objectstack/spec` never declared — as EITHER an image (only when it
 * started with `http`) OR a Lucide icon name. `branding.logo`, the spelling
 * every designer writes, was never read here. Now the header draws
 * `branding.logo` as an image whatever kind of URL it is, and takes an icon
 * name from `icon` only. The retired top-level key draws nothing.
 *
 * The header is read inside the sidebar's own `[data-sidebar="header"]`, so
 * a navigation icon elsewhere cannot answer for it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppComponentSchema } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';

afterEach(() => cleanup());

const BASE: AppComponentSchema = { type: 'app', name: 'acme_crm', title: 'Acme CRM' };

function sidebarHeader(schema: AppComponentSchema): HTMLElement {
  render(
    <MemoryRouter>
      <AppSchemaRenderer schema={schema} basePath="/apps/acme_crm">
        <div>page</div>
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  const header = document.querySelector<HTMLElement>('[data-sidebar="header"]');
  if (!header) throw new Error('AppSchemaRenderer drew no sidebar header');
  return header;
}

const imagesIn = (el: HTMLElement) => [...el.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('AppSchemaRenderer draws `branding.logo` in its sidebar header (objectui#10827)', () => {
  it.each([
    ['a site-relative path', '/assets/acme-logo.png'],
    ['an absolute URL', 'https://cdn.example.test/acme.svg'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
  ])('draws %s as the header image, with the app title as its alt text', (_kind, url) => {
    const header = sidebarHeader({ ...BASE, branding: { logo: url } });
    expect(imagesIn(header)).toEqual([url]);
    expect(header.querySelector('img')?.getAttribute('alt')).toBe('Acme CRM');
  });

  it('CONTROL — an app with no logo draws no image, and the default icon', () => {
    const header = sidebarHeader(BASE);
    expect(imagesIn(header)).toEqual([]);
    expect(header.querySelector('svg.lucide-file-text')).not.toBeNull();
  });

  it('the retired top-level `logo` draws nothing — not as an image, not as an icon name', () => {
    // Cast past the type, as a stale document handed straight to the renderer
    // would be: the key is `never` on the TS face and refused by the mirror.
    const asImage = sidebarHeader({ ...BASE, logo: 'https://cdn.example.test/acme.svg' } as unknown as AppComponentSchema);
    expect(imagesIn(asImage)).toEqual([]);
    cleanup();
    const asIconName = sidebarHeader({ ...BASE, logo: 'Briefcase' } as unknown as AppComponentSchema);
    // Same tile as the no-logo control: the key is not read as an icon name.
    expect(asIconName.querySelector('svg.lucide-file-text')).not.toBeNull();
  });
});
