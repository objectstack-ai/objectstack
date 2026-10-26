/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8055 — `GeolocationField`'s DISPLAY path reads a valid `0`
 * coordinate as "no location", and leaks the literal `0` into the DOM.
 *
 * ## TWO defects, and this file keeps them apart
 *
 * The card measured one reading and correctly separated two independent
 * defects inside it. They are pinned by DIFFERENT assertions here, because
 * fixing either one alone leaves the other live:
 *
 *  1. **Falsy used as a presence test.** `if (!loc.latitude || !loc.longitude)`
 *     asks the parsed NUMBER whether it is falsy, and `0` is falsy — so the
 *     equator (`latitude: 0`), the prime meridian (`longitude: 0`) and a
 *     perfect `accuracy: 0` all took the "no value" branch. Measured on `main`:
 *     `{ latitude: 0, longitude: 120.1551 }` rendered `"—0"` where the control
 *     `{ latitude: 30.2741, longitude: 120.1551 }` rendered
 *     `"30.274100, 120.155100View on map"`.
 *     ⇒ pinned by the "renders the coordinates" assertions.
 *
 *  2. **A numeric operand in a JSX conditional.** The same guard was also
 *     written as `{location.latitude && location.longitude && (…)}`. With
 *     `latitude === 0` that expression evaluates to `0`, and React renders the
 *     NUMBER as a text node — the trailing `0` of `"—0"`.
 *     ⇒ pinned by {@link directTextNodes}, which reads exactly the place such
 *     an operand lands: a text node that is a DIRECT child of the container
 *     holding the guard.
 *
 * ⚠️ The two are pinned separately on purpose. `directTextNodes` stays EMPTY
 * when only defect 1 is live (a boolean guard renders nothing either way), and
 * the coordinate string is still rendered when only defect 2 is live — so
 * neither assertion can stand in for the other. The "View on map" assertions
 * answer to BOTH, because that one site carried both defects; they are the
 * user-facing consequence, not the separator.
 *
 * ## The two live CONTROLS this card came with
 *
 * `value={location.latitude ?? ''}` was ALREADY correct on `main` — it uses
 * `??`, and the box showed `"0"`. It is pinned below as a control: it proves
 * the probe can see this widget and read a `0` out of it, and it must not have
 * been "fixed" into consistency with the broken guards. The non-zero render
 * string is the second control and must be byte-identical to the card's
 * reading.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { FieldMetadata } from '@object-ui/types';
import { GeolocationField, type GeolocationValue } from '../widgets/GeolocationField';

/** U+2014, the glyph `EmptyValue` draws — asserting on it is asserting "no value". */
const EM_DASH = '—';

const field = (name: string, type: string): FieldMetadata =>
  ({ name, label: name, type } as unknown as FieldMetadata);

const noop = () => undefined;

/** The readonly composite collapses to one row; that row is the container. */
function renderReadonly(value: GeolocationValue): HTMLElement {
  const { container } = render(
    <GeolocationField value={value} onChange={noop} field={field('geo', 'location')} readonly />,
  );
  return container.firstElementChild as HTMLElement;
}

/** The editable composite's outer container (`space-y-3`). */
function renderEditable(value: GeolocationValue): HTMLElement {
  const { container } = render(
    <GeolocationField value={value} onChange={noop} field={field('geo', 'location')} />,
  );
  return container.firstElementChild as HTMLElement;
}

/**
 * The non-blank text nodes that are DIRECT children of `el`.
 *
 * ⭐ This is defect 2's oracle, and it is written as a DOM shape rather than as
 * a string diff on purpose: `{0 && <Button/>}` puts the number where React puts
 * any other child — a text node parented by the element holding the guard. A
 * text node nested deeper is somebody's legitimate content (the accuracy row
 * really does render `"Accuracy: ±"`, `"0"`, `"m"` as three nodes), so the
 * scan is deliberately NOT recursive.
 */
function directTextNodes(el: Element): string[] {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3 /* Node.TEXT_NODE */)
    .map((n) => n.textContent ?? '')
    .filter((t) => t.trim() !== '');
}

afterEach(cleanup);

describe('objectui#8055 defect 1 — a `0` coordinate is a PLACE, not an absence', () => {
  it('⭐ readonly: a zero LATITUDE renders the coordinates, not the empty placeholder', () => {
    const row = renderReadonly({ latitude: 0, longitude: 120.1551 });

    // ⛔ Not `not.toContain('—')` alone: that assertion is satisfied by the
    // stray `0` of defect 2 and would call a still-broken widget fixed. The
    // positive half is `toFixed(6)`'s own product, which nothing but a real
    // formatted coordinate can produce.
    expect(row.textContent).toContain('0.000000, 120.155100');
    expect(row.textContent).not.toContain(EM_DASH);
  });

  it('readonly: a zero LONGITUDE is the same rule, not a second one', () => {
    const row = renderReadonly({ latitude: 30.2741, longitude: 0 });
    expect(row.textContent).toContain('30.274100, 0.000000');
    expect(row.textContent).not.toContain(EM_DASH);
  });

  it('readonly: `{ latitude: 0, longitude: 0 }` renders both zeros', () => {
    const row = renderReadonly({ latitude: 0, longitude: 0 });
    expect(row.textContent).toContain('0.000000, 0.000000');
    expect(row.textContent).not.toContain(EM_DASH);
  });

  it('editable: an `accuracy` of 0 renders its row instead of hiding it', () => {
    const outer = renderEditable({ latitude: 30.2741, longitude: 120.1551, accuracy: 0 });
    expect(outer.textContent).toContain('Accuracy: ±0m');
  });
});

describe('objectui#8055 defect 2 — no numeric operand reaches the DOM as a text node', () => {
  it('⭐ readonly: the coordinates row has no bare text-node children', () => {
    const row = renderReadonly({ latitude: 0, longitude: 120.1551 });

    // On `main` this is `['0']` — the trailing `0` of the card's `"—0"`.
    expect(directTextNodes(row)).toEqual([]);
  });

  it('⭐ editable: the button row has no bare text-node children', () => {
    const outer = renderEditable({ latitude: 0, longitude: 120.1551 });
    const buttonRow = outer.firstElementChild as HTMLElement;
    expect(directTextNodes(buttonRow)).toEqual([]);
  });

  it('⭐ editable: the accuracy guard leaks nothing into the outer container', () => {
    const outer = renderEditable({ latitude: 30.2741, longitude: 120.1551, accuracy: 0 });
    expect(directTextNodes(outer)).toEqual([]);
  });
});

describe('objectui#8055 — the affordance the two defects withheld', () => {
  it('readonly: "View on map" is offered for a zero coordinate', () => {
    const row = renderReadonly({ latitude: 0, longitude: 120.1551 });
    expect(row.querySelector('button')?.textContent).toBe('View on map');
  });

  it('editable: both buttons are offered, matching the non-zero control', () => {
    const outer = renderEditable({ latitude: 0, longitude: 120.1551 });
    const labels = Array.from(outer.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Use Current Location', 'View on map']);
  });

  it('the map opens on the real zero coordinate — `openInMaps` refused it too', () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const row = renderReadonly({ latitude: 0, longitude: 120.1551 });

    fireEvent.click(row.querySelector('button') as HTMLButtonElement);

    expect(opened).toHaveBeenCalledWith('https://www.google.com/maps?q=0,120.1551', '_blank');
    opened.mockRestore();
  });
});

describe('objectui#8055 CONTROLS — what must NOT have moved', () => {
  it('⭐ CONTROL: the coordinate boxes already showed `0` and still do (`?? \'\'`)', () => {
    // The card measured this site as ALREADY CORRECT on `main`. A control that
    // goes red with the subject is not a control: this one proves the probe
    // reads a `0` out of this widget, and that the one guard that was right was
    // not "fixed" into consistency with the broken ones.
    const outer = renderEditable({ latitude: 0, longitude: 0 });
    const boxes = Array.from(outer.querySelectorAll('input[type="number"]'));
    expect(boxes.map((b) => (b as HTMLInputElement).value)).toEqual(['0', '0']);
  });

  it('⭐ CONTROL: the non-zero render string is byte-identical to the card`s reading', () => {
    const row = renderReadonly({ latitude: 30.2741, longitude: 120.1551 });
    expect(row.textContent).toBe('30.274100, 120.155100View on map');
  });

  it('CONTROL: a genuinely ABSENT coordinate still renders the empty placeholder', () => {
    const row = renderReadonly({});
    expect(row.textContent).toContain(EM_DASH);
    expect(row.querySelector('button')).toBeNull();
  });

  it('CONTROL: one absent half is still no location — a half pair invents nothing', () => {
    const row = renderReadonly({ latitude: 0 });
    expect(row.textContent).toContain(EM_DASH);
    expect(row.querySelector('button')).toBeNull();
  });

  it('CONTROL: `NaN` stays empty — the delta of this fix is exactly `0`', () => {
    // The presence predicate is nullish AND NaN-excluding, deliberately: a bare
    // `!= null` would have started rendering `"NaN, NaN"` at a surface that has
    // always shown the placeholder for an unreadable coordinate. Every input
    // other than `0` / `-0` answers exactly as it did before this card.
    const row = renderReadonly({ latitude: NaN, longitude: 120.1551 });
    expect(row.textContent).toContain(EM_DASH);
    expect(row.querySelector('button')).toBeNull();
  });
});
