/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A MASKED row offers no copy affordance at all (objectui#8440).
 *
 * ## The defect
 *
 * `@object-ui/fields` renders `password` and `secret` cells as `••••••` — the
 * cell deliberately refuses to show the value. `DetailSection` offered the copy
 * affordance on that same row anyway (`canCopy` is `hasCellValue`, true for any
 * non-empty string, and `canInlineEditField` is false because objectui#4221 put
 * both types in `isInlineExcludedDetailFieldType`), so the row handed the RAW
 * credential to `navigator.clipboard.writeText`. Silently: no error, no visible
 * sign. A masked cell that copies in the clear is worse than an unmasked one,
 * because the reader believes the value is protected.
 *
 * ⇒ maintainer ruling, 2026-09-08, option A: **no copy affordance on masked
 * field types**. ⛔ Not option B — copying the bullets was considered and
 * refused as a second silent wrong answer, so there is nothing for the handler
 * to write and nothing here asserts a `••••••` payload.
 *
 * ## Why every case carries a CONTROL in the same mounted tree
 *
 * The pin is ABSENCE-shaped, which is the shape that passes by never running: a
 * "was not called" assertion is equally satisfied when the row never rendered,
 * when the event never landed, when the component threw during mount, and when
 * the spy was installed on the wrong object. So each masked case, in ONE render:
 *
 *  1. proves the masked cell RENDERED (its text contains the mask) and that the
 *     raw value is nowhere in the document;
 *  2. fires the SAME interaction on an ordinary text row and requires the spy to
 *     receive that row's value — the spy is proved reachable and the interaction
 *     shape is proved able to reach `handleCopyField`;
 *  3. only then requires zero calls from the masked row.
 *
 * Absence is counted AT THE SPY (`writeText.mock.calls`), never with a text
 * query: both masked rows draw the identical string `••••••`, and `queryByText`
 * throws on multiple matches exactly as it does on none.
 *
 * ## Every path that reaches the handler — five, across two layouts
 *
 * The card named three (the desktop row click, Enter/Space on it, and the hover
 * copy button). Measured on this base there are five: the mobile grouped-inset
 * row carries its own click and Enter/Space, gated on `canCopy` alone. A fix
 * that withdrew only the button would leave four live paths and still pass a
 * careless pin, so all five are exercised here, on BOTH the masked rows and the
 * control — a path that silently does nothing on EVERY row cannot read as a fix.
 *
 * ## The non-regression half, derived from the plausible WRONG FIX
 *
 * The wrong fix is gating `canCopy` / `hasCellValue`. It makes the masked row
 * non-copy-interactive AND moves which rows count as EMPTY, because
 * `hasCellValue` is objectui#8376's emptiness authority for this component, not
 * a copy predicate — the toggle count, the auto-hide heuristic and the `No
 * value` placeholder all read it. So this file also pins that a populated
 * masked row is still classified FILLED, and that ordinary rows — including the
 * object-valued ones objectui#8395 fixed — copy byte-for-byte what they copy
 * today.
 *
 * ## Ablation directions (both measured on this file)
 *
 * - "nothing is ever copy-interactive" (`copyOffered = false`) reddens every
 *   CONTROL here, loudly, in both layouts.
 * - "everything is copy-interactive" (`copyOffered = canCopy`, i.e. the defect)
 *   reddens every masked case.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

let writeText: ReturnType<typeof vi.fn>;

/** The two raw credentials. Neither may reach the DOM or the clipboard. */
const RAW_PASSWORD = 's3cret-value';
const RAW_SECRET = 'sk_live_51H8xQ2';
const MASK = '••••••';
const CONTROL_VALUE = 'Plain String Value';

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

const setWidth = (value: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, value });

beforeAll(() => setWidth(DESKTOP_WIDTH));

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(cleanup);

const objectSchema = {
  fields: {
    api_key: { type: 'password', label: 'API Key' },
    token: { type: 'secret', label: 'Token' },
    // The control, and the non-regression rows: a scalar, an object-valued cell
    // (objectui#8395's JSON payload) and a formatted number whose rendered text
    // differs from its stored value.
    name: { type: 'text', label: 'Name' },
    payload: { type: 'json', label: 'Payload' },
    amount: { type: 'number', label: 'Amount', scale: 2 },
  },
};

const DATA: Record<string, unknown> = {
  api_key: RAW_PASSWORD,
  token: RAW_SECRET,
  name: CONTROL_VALUE,
  payload: { a: 1, b: ['x'] },
  amount: 16,
};

const section = {
  title: 'Details',
  fields: Object.entries(objectSchema.fields).map(([name, def]) => ({
    name,
    label: (def as { label: string }).label,
  })),
} as DetailViewSection;

const renderAll = () =>
  render(<DetailSection section={section} data={DATA} objectSchema={objectSchema} />);

/** The row's outer container (label element + value element), by its label. */
const rowContainer = (label: string): HTMLElement => {
  const labelEl = screen.queryByText(label);
  expect(labelEl, `CONTROL: a row labelled "${label}" is on screen`).not.toBeNull();
  return (labelEl as HTMLElement).parentElement as HTMLElement;
};

/**
 * The element that carries the row's click / Enter / Space handlers.
 *
 * Taken by POSITION — the label's last sibling in the desktop layout, the row
 * itself in the mobile one — and ⛔ never by `[role="button"]`: this file exists
 * for rows that must NOT have that role, and a locator requiring it could not
 * address them at all (it would report "no such element" for both the fixed and
 * the broken build).
 */
const desktopRow = (label: string): HTMLElement =>
  rowContainer(label).lastElementChild as HTMLElement;
const mobileRow = (label: string): HTMLElement => rowContainer(label);

type Interaction = { path: string; fire: (row: HTMLElement) => void };

/** The two interactions every row carries in BOTH layouts. */
const ROW_INTERACTIONS: Interaction[] = [
  { path: 'a row click', fire: (row) => fireEvent.click(row) },
  {
    path: 'Enter on the row',
    fire: (row) => fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' }),
  },
  {
    path: 'Space on the row',
    fire: (row) => fireEvent.keyDown(row, { key: ' ', code: 'Space' }),
  },
];

const MASKED_ROWS = [
  { label: 'API Key', type: 'password', raw: RAW_PASSWORD },
  { label: 'Token', type: 'secret', raw: RAW_SECRET },
];

const cross = MASKED_ROWS.flatMap((row) =>
  ROW_INTERACTIONS.map((interaction) => ({ ...row, ...interaction })),
);

/** What the spy received, as an array of arguments — counted at the spy. */
const payloads = () => writeText.mock.calls.map((call) => call[0]);

describe('DetailSection — a masked row offers no copy affordance (#8440)', () => {
  it.each(cross)(
    'MASKED — $path on the $label row ($type) writes NOTHING to the clipboard',
    ({ label, raw, path, fire }) => {
      renderAll();
      const masked = desktopRow(label);

      // CONTROL 1 — the masked cell RENDERED, and rendered the MASK. Without
      // this the absence below would also pass for a row that drew nothing.
      expect(masked.textContent, `CONTROL: the "${label}" cell drew the mask`).toContain(MASK);
      expect(
        document.body.textContent,
        `CONTROL: the raw ${label} value is nowhere on screen`,
      ).not.toContain(raw);

      // CONTROL 2 — the SAME interaction on an ordinary row reaches the
      // clipboard, in this same mounted tree. The spy is reachable and this
      // interaction shape does reach `handleCopyField`.
      writeText.mockClear();
      fire(desktopRow('Name'));
      expect(
        payloads(),
        `CONTROL: ${path} on the ordinary text row copies its own value`,
      ).toEqual([CONTROL_VALUE]);

      // The pin.
      writeText.mockClear();
      fire(masked);
      expect(payloads(), `${path} on the "${label}" row must write nothing`).toEqual([]);
    },
  );

  it.each(MASKED_ROWS)(
    'MASKED — the $label row ($type) offers no hover copy BUTTON, and no button at all',
    ({ label, raw }) => {
      renderAll();

      // CONTROL — the ordinary row DOES carry exactly one button, and clicking
      // it copies that row's value. So the absence below is a decision about
      // this row and not about the feature being gone.
      const controlButton = desktopRow('Name').querySelector('button');
      expect(controlButton, 'CONTROL: the ordinary row carries a copy button').not.toBeNull();
      writeText.mockClear();
      fireEvent.click(controlButton as HTMLElement);
      expect(payloads(), 'CONTROL: the copy button copies the ordinary row').toEqual([
        CONTROL_VALUE,
      ]);

      const masked = desktopRow(label);
      expect(masked.textContent, `CONTROL: the "${label}" cell drew the mask`).toContain(MASK);
      expect(
        masked.querySelector('button'),
        `the "${label}" row must offer no copy button`,
      ).toBeNull();
      expect(
        document.body.textContent,
        `the raw ${label} value never reaches the DOM`,
      ).not.toContain(raw);
    },
  );

  it.each(MASKED_ROWS)(
    'MASKED — the $label row ($type) does not advertise itself as interactive',
    ({ label }) => {
      renderAll();

      // CONTROL — the ordinary row is a keyboard-reachable button.
      const control = desktopRow('Name');
      expect(control.getAttribute('role'), 'CONTROL: the ordinary row is a button').toBe('button');
      expect(control.getAttribute('tabindex'), 'CONTROL: the ordinary row is focusable').toBe('0');

      const masked = desktopRow(label);
      expect(masked.textContent, `CONTROL: the "${label}" cell drew the mask`).toContain(MASK);
      expect(masked.getAttribute('role'), `the "${label}" row is not a button`).toBeNull();
      expect(
        masked.getAttribute('tabindex'),
        `the "${label}" row is not in the tab order`,
      ).toBeNull();
    },
  );
});

describe('DetailSection — the mobile grouped-inset row refuses too (#8440)', () => {
  // ⚠️ The mobile layout is a SEPARATE render path with its own two reach sites,
  // gated on `canCopy` alone rather than on `copyInteractive`. The card named
  // only the desktop three; a fix pinned there alone would leave a credential
  // one tap from the clipboard on the target where this layout ships.
  beforeEach(() => setWidth(MOBILE_WIDTH));
  afterEach(() => setWidth(DESKTOP_WIDTH));

  it.each(cross)(
    'MOBILE — $path on the $label row ($type) writes NOTHING to the clipboard',
    ({ label, raw, path, fire }) => {
      renderAll();
      const masked = mobileRow(label);

      // CONTROL 0 — this really is the mobile layout: its row IS the label's
      // parent and carries the value beside the label, so `desktopRow` and
      // `mobileRow` disagree here. Read through the copy affordance the layout
      // offers on the control row below.
      expect(masked.textContent, `CONTROL: the "${label}" cell drew the mask`).toContain(MASK);
      expect(
        document.body.textContent,
        `CONTROL: the raw ${label} value is nowhere on screen`,
      ).not.toContain(raw);

      const control = mobileRow('Name');
      expect(
        control.getAttribute('role'),
        'CONTROL: the mobile layout rendered, and its ordinary row is a button',
      ).toBe('button');

      writeText.mockClear();
      fire(control);
      expect(
        payloads(),
        `CONTROL: ${path} on the ordinary mobile row copies its own value`,
      ).toEqual([CONTROL_VALUE]);

      writeText.mockClear();
      fire(masked);
      expect(payloads(), `${path} on the mobile "${label}" row must write nothing`).toEqual([]);
      expect(
        masked.getAttribute('role'),
        `the mobile "${label}" row is not a button`,
      ).toBeNull();
    },
  );
});

describe('DetailSection — what the refusal must NOT move (#8440 non-regression)', () => {
  /**
   * ⭐ Derived from the plausible WRONG FIX, not from the shape of the bug.
   *
   * Gating `canCopy` — i.e. teaching `hasCellValue` about the mask — satisfies
   * every vivid assertion above and silently moves the EMPTINESS answer for the
   * whole record page: the "Show N empty fields" counter, the auto-hide
   * heuristic, the `No value` placeholder, the highlight strip and the summary
   * chips all read that one function (objectui#8376 / #8394). A populated
   * credential is not an empty row; it is a row whose value this surface
   * declines to hand over.
   */
  const emptinessSchema = {
    fields: {
      api_key: { type: 'password', label: 'API Key' },
      name: { type: 'text', label: 'Name' },
      notes: { type: 'text', label: 'Notes' },
      close_date: { type: 'text', label: 'Close Date' },
    },
  };

  const renderEmptinessFixture = () =>
    render(
      <DetailSection
        section={
          {
            title: 'Details',
            fields: Object.entries(emptinessSchema.fields).map(([name, def]) => ({
              name,
              label: (def as { label: string }).label,
            })),
          } as DetailViewSection
        }
        // 4 fields, 2 of them absent: at both auto-hide thresholds (≥4 fields,
        // ≥25% empty), so the toggle appears and its count is readable.
        data={{ api_key: RAW_PASSWORD, name: CONTROL_VALUE }}
        objectSchema={emptinessSchema}
      />,
    );

  it('EMPTINESS — a populated masked row is still counted FILLED, not empty', () => {
    renderEmptinessFixture();

    // CONTROL — the section rendered and kept its ordinary filled row.
    expect(screen.queryByText('Details'), 'CONTROL: the section heading rendered').not.toBeNull();
    expect(screen.queryByText(CONTROL_VALUE), 'CONTROL: the filled text row rendered').not.toBeNull();

    const toggle = screen.getByRole('button', { name: /empty fields/i });
    expect(
      toggle.textContent,
      'exactly the two ABSENT rows are empty — the masked row is not one of them',
    ).toContain('Show 2 empty fields');

    // It was not counted, so it was not hidden: the masked row is on screen,
    // drawing the mask rather than the `No value` placeholder.
    const masked = rowContainer('API Key');
    expect(masked.textContent, 'the masked row is visible and drew the mask').toContain(MASK);
    expect(
      masked.querySelector('[title="No value"]'),
      'a populated masked row must not draw the `No value` affordance',
    ).toBeNull();
    expect(
      screen.queryAllByTitle('No value'),
      'the two empty rows are hidden, so no placeholder is drawn yet',
    ).toHaveLength(0);

    // Revealing them shows exactly two placeholders — still not the masked row.
    fireEvent.click(toggle);
    expect(
      screen.queryAllByTitle('No value'),
      'revealing the empty fields draws exactly the two absent rows',
    ).toHaveLength(2);
    expect(
      rowContainer('API Key').textContent,
      'the masked row still draws the mask after the reveal',
    ).toContain(MASK);
  });

  const UNCHANGED = [
    { label: 'Name', rendered: CONTROL_VALUE, clipboard: CONTROL_VALUE },
    // The object-valued kind objectui#8395 fixed: JSON of the STORED value.
    { label: 'Payload', rendered: '{"a":1,"b":["x"]}', clipboard: '{"a":1,"b":["x"]}' },
    // Rendered and stored differ on purpose — the payload is the stored value.
    { label: 'Amount', rendered: '16.00', clipboard: '16' },
  ];

  it.each(UNCHANGED)(
    'ORDINARY — the $label row still copies exactly what it copies today',
    ({ label, rendered, clipboard }) => {
      renderAll();
      const row = desktopRow(label);

      expect(row.textContent, `CONTROL: the "${label}" cell rendered its value`).toContain(
        rendered,
      );

      writeText.mockClear();
      fireEvent.click(row);
      expect(payloads(), `"${label}" copies the STORED value, unchanged`).toEqual([clipboard]);
    },
  );
});

describe('DetailSection — the gate is the narrow-only UNION of the two types (#8440)', () => {
  /**
   * ⚠️ DECLARED DESIGN CHOICE, in the shape objectui#3355 already fixed for the
   * editability gates: the view's authored `type` and the object schema's
   * `type` are read SEPARATELY and the answer is their union, so a PRESENTATION
   * override can withdraw the copy affordance but never restore it.
   *
   * The measured cost is the first case below: an authored `text` over an
   * object-schema `secret` renders the value in the CLEAR (the cell renderer
   * follows display precedence), and the copy affordance is still withheld. The
   * alternative — following display precedence here too — would let a view
   * author re-open one-click exfiltration of a credential column by writing one
   * key, which is precisely the direction objectui#3355 closed.
   */
  const unionSchema = {
    fields: {
      token: { type: 'secret', label: 'Token' },
      nickname: { type: 'text', label: 'Nickname' },
      name: { type: 'text', label: 'Name' },
    },
  };

  const renderUnion = () =>
    render(
      <DetailSection
        section={
          {
            title: 'Details',
            fields: [
              // An authored display type over a credential column…
              { name: 'token', label: 'Token', type: 'text' },
              // …and the mirror: a credential type authored over a text column.
              { name: 'nickname', label: 'Nickname', type: 'password' },
              { name: 'name', label: 'Name' },
            ],
          } as unknown as DetailViewSection
        }
        data={{ token: RAW_SECRET, nickname: 'not-really-a-secret', name: CONTROL_VALUE }}
        objectSchema={unionSchema}
      />,
    );

  it('an authored display type does not restore the affordance on a credential column', () => {
    renderUnion();

    // CONTROL — the ordinary row still copies, in this same tree.
    writeText.mockClear();
    fireEvent.click(desktopRow('Name'));
    expect(payloads(), 'CONTROL: the ordinary row copies its value').toEqual([CONTROL_VALUE]);

    const row = desktopRow('Token');
    // The declared cost, asserted rather than waved past: the authored `text`
    // means the CELL shows the value. The refusal is about the copy affordance.
    expect(
      row.textContent,
      'DECLARED: the authored `text` type renders the value in the clear',
    ).toContain(RAW_SECRET);

    writeText.mockClear();
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
    expect(payloads(), 'the object schema still says `secret`, so no copy is offered').toEqual([]);
    expect(row.querySelector('button'), 'and no copy button either').toBeNull();
  });

  it('an authored credential type withdraws the affordance from a plain column', () => {
    renderUnion();

    writeText.mockClear();
    fireEvent.click(desktopRow('Name'));
    expect(payloads(), 'CONTROL: the ordinary row copies its value').toEqual([CONTROL_VALUE]);

    const row = desktopRow('Nickname');
    expect(row.textContent, 'the authored `password` type masks the cell').toContain(MASK);

    writeText.mockClear();
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
    expect(payloads(), 'a masked cell offers no copy, whichever type spelled the mask').toEqual([]);
    expect(row.querySelector('button'), 'and no copy button either').toBeNull();
  });
});
