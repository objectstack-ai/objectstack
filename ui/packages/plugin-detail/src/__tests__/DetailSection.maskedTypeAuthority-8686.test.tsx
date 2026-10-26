/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The detail page's copy refusal reads the fields package's masked-type
 * AUTHORITY, not a list of its own (objectui#8686).
 *
 * objectui#8440 made a masked row refuse the copy affordance, and had to name
 * `password` / `secret` a second time in `fieldEnrichment.ts` to do it: a
 * mirror, with the cost written beside it — a masked type added in
 * `@object-ui/fields` would render masked and stay copy-interactive here until
 * someone edited that mirror. The objectui#8686 ruling's pin is exactly that
 * case: register a NEW masked type in `fields`, and this page refuses the copy
 * with no edit to `plugin-detail`.
 *
 * The new type is registered the way a host does it, through the published
 * `registerFieldRenderer` with the mask `getCellRenderer('password')` resolves
 * to. Its spelling appears nowhere in `plugin-detail`, so only a live read of
 * the authority can refuse it.
 *
 * Each case carries a CONTROL LEG in the same test: before the registration the
 * very same row draws the value and copies it. The refusal after it is thereby
 * attributable to the registration, and not to a row that never rendered or a
 * spy that was never reachable. The five copy paths and the ordinary-row
 * control follow `DetailSection.maskedCopyRefusal-8440`.
 *
 * ⚠️ `registerFieldRenderer` has no inverse. This file is a `.tsx` (the `dom`
 * project, `isolate: true`), and every override of a shipped type is restored.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { getCellRenderer, registerFieldRenderer, TextCellRenderer } from '@object-ui/fields';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

let writeText: ReturnType<typeof vi.fn>;

const NEW_MASKED_TYPE = 'objectui_8686_api_token';
const RAW = 'sk_live_objectui_8686';
const MASK = '••••••';
const CONTROL_VALUE = 'Plain String Value';

beforeAll(() =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }),
);

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(cleanup);

const renderRows = (credentialType: string) => {
  const objectSchema = {
    fields: {
      token: { type: credentialType, label: 'Token' },
      name: { type: 'text', label: 'Name' },
    },
  };
  return render(
    <DetailSection
      section={
        {
          title: 'Details',
          fields: [
            { name: 'token', label: 'Token' },
            { name: 'name', label: 'Name' },
          ],
        } as DetailViewSection
      }
      data={{ token: RAW, name: CONTROL_VALUE }}
      objectSchema={objectSchema}
    />,
  );
};

/** The desktop row element carrying the click / Enter / Space handlers. */
const desktopRow = (label: string): HTMLElement => {
  const labelEl = screen.queryByText(label);
  expect(labelEl, `CONTROL: a row labelled "${label}" is on screen`).not.toBeNull();
  return ((labelEl as HTMLElement).parentElement as HTMLElement).lastElementChild as HTMLElement;
};

const payloads = () => writeText.mock.calls.map((call) => call[0]);

/** Every copy path a desktop row carries, the hover button included. */
function fireEveryCopyPath(row: HTMLElement) {
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
  fireEvent.keyDown(row, { key: ' ', code: 'Space' });
  const button = row.querySelector('button');
  if (button) fireEvent.click(button);
}

describe('DetailSection — copy refusal reads the fields authority (#8686)', () => {
  it('a masked type registered in `fields` refuses the copy here, with no edit to plugin-detail', () => {
    // CONTROL LEG — before the registration the type is unknown to `fields`:
    // the cell draws the value and the row copies it, on the same paths.
    renderRows(NEW_MASKED_TYPE);
    const before = desktopRow('Token');
    expect(before.textContent, 'CONTROL: unregistered, the cell draws the value').toContain(RAW);
    writeText.mockClear();
    fireEvent.click(before);
    expect(payloads(), 'CONTROL: unregistered, the row copies its value').toEqual([RAW]);
    cleanup();

    registerFieldRenderer(NEW_MASKED_TYPE, getCellRenderer('password'));

    renderRows(NEW_MASKED_TYPE);
    const masked = desktopRow('Token');
    expect(masked.textContent, 'the registered type now draws the mask').toContain(MASK);
    expect(document.body.textContent, 'the raw value is nowhere on screen').not.toContain(RAW);

    // CONTROL — the ordinary row still copies, in this same mounted tree.
    writeText.mockClear();
    fireEvent.click(desktopRow('Name'));
    expect(payloads(), 'CONTROL: the ordinary row copies its value').toEqual([CONTROL_VALUE]);

    // The pin.
    writeText.mockClear();
    fireEveryCopyPath(masked);
    expect(payloads(), 'no copy path on the masked row writes anything').toEqual([]);
    expect(masked.querySelector('button'), 'and it offers no copy button').toBeNull();
    expect(masked.getAttribute('role'), 'and it is not advertised as a button').toBeNull();
  });

  it("a host that replaces a shipped mask with one of the package's text renderers gets its copy back", () => {
    // The runtime-override half of the ruling. The cell now shows the value,
    // so withholding the copy would refuse what is already on screen.
    const mask = getCellRenderer('password');
    // CONTROL LEG — the shipped mask refuses the copy.
    renderRows('password');
    writeText.mockClear();
    fireEveryCopyPath(desktopRow('Token'));
    expect(payloads(), 'CONTROL: the shipped `password` mask refuses the copy').toEqual([]);
    cleanup();

    try {
      registerFieldRenderer('password', TextCellRenderer);
      renderRows('password');
      const row = desktopRow('Token');
      expect(row.textContent, 'the override draws the value').toContain(RAW);
      writeText.mockClear();
      fireEvent.click(row);
      expect(payloads(), 'and the row copies what it shows').toEqual([RAW]);
    } finally {
      registerFieldRenderer('password', mask);
    }
  });
});
