/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12772 — `record:quick_actions` (the record-header path) draws a
 * declared `ActionSchema.icon` beside the button's label. The producer that
 * filed it is a control-plane "Open" action declaring `icon: 'external-link'`
 * on `record_header`.
 *
 *  (a) a declared, known name draws its glyph AND keeps the label;
 *  (b) CONTROL — no `icon` declared ⇒ the button's markup is the label alone,
 *      exactly what this surface rendered before the icon was read;
 *  (c) an unknown name draws no glyph and does not throw — the label alone.
 *
 * The host is driven for real (`useActionEngine` filters by `locations`), so
 * the def the button reads is the one the engine hands back — the `icon`
 * surviving that path is part of what (a) pins. The glyph is asserted by its
 * `lucide-<kebab>` class, which the shared icon seam draws in the same tick.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const LABEL = 'Open';
/** `locations` is not defaulted — `getActionsForLocation` requires the match. */
const OPEN = { name: 'open', label: LABEL, type: 'script', locations: ['record_header'] };

function mount(action: Record<string, unknown>) {
  return render(
    <RecordContextProvider objectName="sys_environment" recordId="rec-1" data={{ id: 'rec-1' }}>
      <RecordQuickActionsRenderer schema={{ actions: [action] } as any} />
    </RecordContextProvider>,
  );
}

const button = () => screen.getByRole('button', { name: LABEL });

describe('record:quick_actions draws a declared icon beside the label (objectui#12772)', () => {
  it("(a) icon: 'external-link' renders the glyph and the label", () => {
    mount({ ...OPEN, icon: 'external-link' });
    expect(button().querySelector('svg.lucide-external-link')).not.toBeNull();
    expect(button()).toHaveTextContent(LABEL);
  });

  it('(b) CONTROL: no icon declared → the button holds the label alone', () => {
    mount(OPEN);
    expect(button().querySelector('svg')).toBeNull();
    expect(button().innerHTML).toBe(LABEL);
  });

  it('(c) an unknown icon name → the label alone, no glyph, no throw', () => {
    expect(() => mount({ ...OPEN, icon: 'definitely-not-a-lucide-glyph' })).not.toThrow();
    expect(button().querySelector('svg')).toBeNull();
    expect(button().innerHTML).toBe(LABEL);
  });
});
