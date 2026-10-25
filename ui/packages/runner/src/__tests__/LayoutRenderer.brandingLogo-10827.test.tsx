/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runner's sidebar brand mark reads `branding.logo` (objectui#10827).
 *
 * `LayoutRenderer` used to read a top-level `logo`, a second spelling
 * `@objectstack/spec` never declared, and guess its kind: a value with no `/`
 * and no `.` was an icon name, anything else an image URL. The logo now has
 * one spelling, `branding.logo`, drawn as an image; an icon name comes from
 * `icon`; with neither, the `Box` mark stays — the control.
 *
 * Read inside the `<aside>` the sidebar layout draws, so the header's own
 * icons cannot answer for it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { AppComponentSchema } from '@object-ui/types';

// Static, module-scope import: `LayoutRenderer` pulls `@object-ui/components`
// in, and that cost must not land inside a test's timeout budget (AGENTS.md
// 测试纪律).
import { LayoutRenderer } from '../LayoutRenderer';

afterEach(() => cleanup());

const BASE: AppComponentSchema = { type: 'app', name: 'acme_crm', title: 'Acme CRM', layout: 'sidebar' };

function aside(app: AppComponentSchema): HTMLElement {
  const { container } = render(
    <LayoutRenderer app={app}>
      <div>page body</div>
    </LayoutRenderer>,
  );
  const el = container.querySelector('aside');
  if (!el) throw new Error('LayoutRenderer drew no <aside> for a `sidebar` layout');
  return el;
}

const imagesIn = (el: HTMLElement) => [...el.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('LayoutRenderer draws `branding.logo` as the sidebar brand mark (objectui#10827)', () => {
  it('draws `branding.logo` as an image, with the app title as its alt text', () => {
    const el = aside({ ...BASE, branding: { logo: '/assets/acme-logo.png' } });
    expect(imagesIn(el)).toEqual(['/assets/acme-logo.png']);
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('Acme CRM');
    expect(el.querySelector('svg.lucide-box')).toBeNull();
  });

  it('CONTROL — no logo and no icon keeps the `Box` mark and draws no image', () => {
    const el = aside(BASE);
    expect(imagesIn(el)).toEqual([]);
    expect(el.querySelector('svg.lucide-box')).not.toBeNull();
  });

  it('the retired top-level `logo` draws nothing — the `Box` mark stays', () => {
    // Cast past the type: the runner loads its document without the validator,
    // so a stale `app.json` can still hold the key.
    const el = aside({ ...BASE, logo: '/assets/acme-logo.png' } as unknown as AppComponentSchema);
    expect(imagesIn(el)).toEqual([]);
    expect(el.querySelector('svg.lucide-box')).not.toBeNull();
  });
});
