/**
 * Regression: `page:card` title must resolve inline-i18n shapes (`{ en, zh }`)
 * through `pickLocalized`, not the old `labelText` (which only understood
 * `{ default, value }`).
 *
 * Before the fix, a server-driven page that titled its cards with `{ en, zh }`
 * — e.g. the Cloud Pricing page's per-plan name + price headings — rendered a
 * BLANK title in every locale (`labelText({en,zh})` → '' → CardHeader skipped).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

function PageCard({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:card');
  if (!Component) throw new Error('page:card not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const i18nTitle = { en: 'Solo — $29/mo', zh: 'Solo 版 — $29/月' };

describe('PageCardRenderer — localized title', () => {
  it('renders the English title for an { en, zh } shape by default', () => {
    render(<PageCard schema={{ type: 'page:card', title: i18nTitle, body: [] }} />);
    // The regression guard: this was '' (no heading) before pickLocalized.
    expect(screen.getByText('Solo — $29/mo')).toBeTruthy();
  });

  it('still renders a plain string title unchanged', () => {
    render(<PageCard schema={{ type: 'page:card', title: 'Business', body: [] }} />);
    expect(screen.getByText('Business')).toBeTruthy();
  });
});
