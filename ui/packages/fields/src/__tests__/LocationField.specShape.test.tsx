/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6272 — `LocationField` reads and writes `@objectstack/spec`'s
 * `LocationValue` (`{ lat, lng }`), the shape the platform's own contract
 * enforces.
 *
 * The defect: this widget was the ONE `type: 'location'` surface reading
 * `value.latitude` / `value.longitude`, each behind `|| 0`. So a spec-canonical
 * `{ lat, lng }` record rendered `0, 0` in the edit box — not an error state
 * but a valid coordinate in the Gulf of Guinea — while the SAME record rendered
 * correctly one panel away in the detail view and on the map, which read
 * `lat`/`lng` first. `valueSchemaFor({ type: 'location' })` REJECTS
 * `{ latitude, longitude }` (`invalid_type` at `[lat]`, `[lng]`) and ACCEPTS
 * `{ lat, lng }`, so the widget — not the display side — was the producer at
 * fault.
 *
 * Maintainer ruling 2026-08-28 (「6272 A1 其他同意」), option A1, chosen
 * explicitly over a read-side compatibility shim: the flip is BARE. A record
 * stored in the deprecated `{ latitude, longitude }` spelling now renders EMPTY
 * here until it is re-saved. That is pinned below as ruled behaviour, not
 * tolerated behaviour — `renders empty` is the assertion that fails the day
 * somebody adds the fallback back.
 *
 * Every emission is checked against the SPEC SCHEMA rather than against a
 * hand-written expected object alone: an equality assertion on `{ lat, lng }`
 * would keep passing if the spec moved, and the whole point of this card is
 * that the widget must agree with the contract, not with a copy of it.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { valueSchemaFor } from '@objectstack/spec/data';
import type { LocationValue as SpecLocationValue } from '@objectstack/spec/data';

import { LocationField, type LocationValue } from '../widgets/LocationField';
import { getCellRenderer, resolveCellRendererType } from '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pin: the exported name IS the spec's, not a local re-spelling.  */
/* This package's tsconfig includes its tests, so `type-check` compiles this.   */
/* -------------------------------------------------------------------------- */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type _LocationValueIsTheSpecs = Assert<Equal<LocationValue, SpecLocationValue>>;

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

/** The card's coordinate, in the spec spelling. */
const CANONICAL: LocationValue = { lat: 30.2741, lng: 120.1551 };
/** The same point in the spelling the spec deprecates and rejects. */
const DEPRECATED = { latitude: 30.2741, longitude: 120.1551 };

const field = { name: 'site', label: 'Site', type: 'location' } as any;

function renderReadonly(value: unknown) {
  return render(
    <LocationField field={field} value={value as LocationValue | null} onChange={vi.fn()} readonly />,
  );
}

describe('LocationField reads the spec shape (objectui#6272)', () => {
  it('renders a spec-canonical { lat, lng } as its coordinate pair', () => {
    // The regression itself: this rendered `0, 0` before the flip.
    const { container } = renderReadonly(CANONICAL);
    expect(container.textContent).toBe('30.2741, 120.1551');
  });

  it('agrees with the display surface on the same stored value', () => {
    // The card's decisive comparison — one record, two consumers. The edit
    // surface and the display registry the detail page calls must now read the
    // same value the same way.
    const edit = renderReadonly(CANONICAL);
    const Renderer = getCellRenderer(resolveCellRendererType({ type: 'location' } as any) || 'location');
    const display = render(<Renderer value={CANONICAL as any} field={field} />);
    expect(edit.container.textContent).toContain('30.2741');
    expect(display.container.textContent).toContain('30.2741');
    expect(display.container.textContent).toContain('120.1551');
  });

  it('carries a zero coordinate as the real place it is, not as a default', () => {
    // `0, 0` must still be renderable — it is a valid coordinate. What changed
    // is that it can now ONLY come from a stored `{ lat: 0, lng: 0 }`, never
    // from a `|| 0` standing in for a key the widget could not find.
    const { container } = renderReadonly({ lat: 0, lng: 0 });
    expect(container.textContent).toBe('0, 0');
  });

  it('keeps the optional spec keys out of the rendered pair', () => {
    const { container } = renderReadonly({ lat: 30.2741, lng: 120.1551, altitude: 5, accuracy: 1 });
    expect(container.textContent).toBe('30.2741, 120.1551');
  });
});

describe('LocationField has NO fallback to the deprecated spelling (ruled A1)', () => {
  it('renders a { latitude, longitude } record EMPTY, not as coordinates', () => {
    // Ruled consequence, pinned: the maintainer chose the bare flip over a
    // read-side shim, so a record in the retired spelling reads as unset here
    // (it stays correct in detail views and on the map). If a compatibility
    // fallback is ever reintroduced, this assertion is what fails.
    const { container } = renderReadonly(DEPRECATED);
    expect(container.textContent).not.toContain('30.2741');
    expect(container.textContent).not.toContain('120.1551');
    // The empty-value placeholder, i.e. the widget's own "nothing stored" face.
    expect(screen.getByLabelText('No value')).toBeInTheDocument();
  });

  it('renders the editable box empty for a { latitude, longitude } record', () => {
    render(<LocationField field={field} value={DEPRECATED as any} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('never invents the missing half of a pair', () => {
    // `{ lat }` alone used to read `0, 0` and `{ latitude }` alone `30.2741, 0`
    // — a longitude the record does not carry. Both are unreadable values now.
    for (const half of [{ lat: 30.2741 }, { lng: 120.1551 }, { latitude: 30.2741 }]) {
      const { container } = renderReadonly(half);
      expect(container.textContent).not.toContain(', 0');
      expect(container.textContent).not.toContain('30.2741');
      cleanup();
    }
  });

  it('reads nothing out of the shapes the spec rejects outright', () => {
    for (const rejected of ['30.2741,120.1551', [30.2741, 120.1551], { lat: '30.2741', lng: '120.1551' }]) {
      expect(LOCATION_SCHEMA.safeParse(rejected).success).toBe(false);
      const { container } = renderReadonly(rejected);
      expect(container.textContent).not.toContain('30.2741');
      cleanup();
    }
  });
});

describe('LocationField writes the spec shape (objectui#6272)', () => {
  it('emits a value the spec ACCEPTS', () => {
    const onChange = vi.fn();
    render(<LocationField field={field} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '30.2741, 120.1551' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0];
    expect(emitted).toEqual({ lat: 30.2741, lng: 120.1551 });
    // The load-bearing half: the platform's own validator, not a copy of it.
    const parsed = LOCATION_SCHEMA.safeParse(emitted);
    expect(parsed.success).toBe(true);
    // …and the shape it replaced is the one that validator rejects.
    expect(LOCATION_SCHEMA.safeParse(DEPRECATED).success).toBe(false);
  });

  it('round-trips: what it emits is what it reads back', () => {
    const onChange = vi.fn();
    render(<LocationField field={field} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '40.7128, -74.006' } });
    cleanup();

    const { container } = renderReadonly(onChange.mock.calls[0][0]);
    expect(container.textContent).toBe('40.7128, -74.006');
  });

  it('emits null when the box is cleared', () => {
    const onChange = vi.fn();
    render(<LocationField field={field} value={CANONICAL} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('30.2741, 120.1551'), { target: { value: '  ' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('leaves the value alone when the text is not a coordinate pair', () => {
    const onChange = vi.fn();
    render(<LocationField field={field} value={CANONICAL} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('30.2741, 120.1551'), { target: { value: 'somewhere' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
