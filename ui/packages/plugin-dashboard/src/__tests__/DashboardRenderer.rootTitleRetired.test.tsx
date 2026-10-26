/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the dashboard-ROOT `title` read arm (objectui#7509).
 *
 * Maintainer ruling 2026-09-04 (decision batch #29, option C): the five root
 * `title` read arms retire together under ADR-0049. `label` — REQUIRED on
 * `@objectstack/spec`'s `DashboardSchema` — is the only header source. This
 * file pins THIS surface's arm (`const headerTitle = schema.label`); the four
 * siblings carry their own.
 *
 * Shaped like the #5830 / #5852 retirements: the assertion is what a document
 * carrying the retired key RENDERS, not that the code compiles. Only ONE of
 * this file's five `.title` occurrences was the retired arm — the rest are
 * widget-level, and the last case here is their control.
 *
 * Why this surface is the load-bearing one: `DashboardView` renders its own
 * header and passes `hideHeaderText`, so a standalone embed is where a stored
 * document's root name actually reaches the DOM through this component. The
 * header wrapper is gated on `header` being DECLARED (objectui#5812), so every
 * fixture below declares it — a fixture without `header` would assert the
 * absence of a title that the wrapper gate had already removed, and would pass
 * with the retired arm fully intact.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// From the barrel, so the ComponentRegistry is populated for the widget control.
import { DashboardRenderer } from '../index';

afterEach(cleanup);

const LEGACY_TITLE = 'Legacy Title From A Stored Document';
const CANONICAL_LABEL = 'Executive Overview';

const dash = (root: Record<string, unknown>): DashboardComponentSchema =>
  ({
    type: 'dashboard',
    widgets: [],
    // Declared so the header wrapper exists at all; `showTitle` defaults on.
    header: { showTitle: true },
    ...root,
  }) as unknown as DashboardComponentSchema;

describe('DashboardRenderer — the root `title` read arm is retired (objectui#7509)', () => {
  it('renders the `label` header for a document carrying BOTH, and never the `title`', () => {
    render(<DashboardRenderer schema={dash({ label: CANONICAL_LABEL, title: LEGACY_TITLE })} />);

    expect(screen.getByText(CANONICAL_LABEL)).toBeTruthy();
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('renders NO header text for a document carrying ONLY the retired key', () => {
    // `label` is REQUIRED on DashboardSchema, so such a document was already
    // invalid. It is pinned anyway: a renderer cannot refuse to receive stored
    // metadata, and this is where the retirement is actually felt.
    const { container } = render(<DashboardRenderer schema={dash({ title: LEGACY_TITLE })} />);

    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
    expect(container.querySelector('h2')).toBeNull();
  });

  it('CONTROL — a document with only `label` renders it, so the two assertions above are not vacuous', () => {
    // Without this, "the legacy title is absent" would also be satisfied by a
    // renderer that draws no header at all under any input.
    render(<DashboardRenderer schema={dash({ label: CANONICAL_LABEL })} />);

    const heading = screen.getByText(CANONICAL_LABEL);
    expect(heading).toBeTruthy();
    expect(heading.tagName).toBe('H2');
  });

  it('CONTROL — widget-level `title` is a different DECLARED key and still renders', () => {
    // `DashboardWidget.title` is the spec's `I18nLabel`; the ruling keeps it.
    // Four of this file's five `.title` occurrences are on this receiver, so a
    // grep-driven sweep would have deleted live contract-declared behaviour.
    render(
      <DashboardRenderer
        schema={dash({
          label: CANONICAL_LABEL,
          title: LEGACY_TITLE,
          widgets: [{ id: 'w1', type: 'metric', title: 'Revenue', options: { value: 42 } }],
        })}
      />,
    );

    expect(screen.getByText('Revenue')).toBeTruthy();
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });
});
