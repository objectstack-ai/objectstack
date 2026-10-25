// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PicklistStub` inside `FieldStub` used to compute its preview as
 *
 *     const visible = opts.slice(0, single ? 1 : 3).filter((o) => o.value || o.label);
 *
 * — the slice runs BEFORE the filter, so entries the filter drops still
 * consume the display budget (objectui#9074). One cause, two symptoms:
 *
 *   1. a well-formed option sitting BEHIND malformed ones never renders,
 *      because the malformed ones ate the whole budget; and
 *   2. the overflow counter, `opts.length - visible.length`, counts the
 *      malformed entries too, so `+N` promises badges no surface can show.
 *
 * Both are pinned here, in two families that fail INDEPENDENTLY — no assertion
 * does double duty, because the plausible wrong repair is the one that gets the
 * counter right and leaves the option missing. Measured, by mutating each half
 * of the repair on its own: reverting only the counter's population reds the
 * counter family alone, and the caricature that keeps the slice-first order
 * while computing an honest-looking `+N` reds the rendering family alone.
 *
 * ## The fixtures are the projection, not the authored list
 *
 * `ObjectFormCanvas` is the only consumer of `FieldStub`, and it projects the
 * authored `options` through
 *
 *     value: String(o.value ?? ''), label: typeof o.label === 'string' ? o.label : undefined
 *
 * so a bare string, a `null`, a number, or an option with no `value` all
 * arrive here as `{ value: '', label: undefined }`. That shape — not the
 * author's original entry — is what the stub filters on, so it is what these
 * fixtures carry.
 *
 * ## Order is load-bearing in the fixtures
 *
 * ⚠️ Malformed entries must come FIRST. With them last the slice never
 * reaches them, the defect cannot reproduce, and the pin would pass against
 * the unrepaired component — decorative, not discriminating. The
 * malformed-LAST case is kept below as a positional contrast: it renders
 * `Real` on both sides of the repair, which is what identifies the
 * slice/filter ORDERING as the cause rather than the filter itself.
 *
 * ## Control
 *
 * A picklist with NO malformed options is the same KIND of subject (same
 * component, same branch, same code path), pre-exists this change and is
 * untouched by it: when every entry survives the filter, `filter`-then-`slice`
 * and `slice`-then-`filter` compute the same `visible` and the same `+N`.
 * It is asserted in the same run so a repair that quietly changes how ordinary
 * picklists preview fails here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FieldStub } from './FieldStub';

afterEach(cleanup);

type Opt = { value: string; label?: string };

/** What `ObjectFormCanvas` hands us for a malformed authored option. */
function malformed(): Opt {
  return { value: '', label: undefined };
}

function wellFormed(value: string, label: string): Opt {
  return { value, label };
}

/**
 * The card's own repro: authored `['draft', 'open', 'closed', { value: 'real',
 * label: 'Real' }]` — three malformed entries, then one well-formed one.
 */
const MALFORMED_FIRST: Opt[] = [
  malformed(),
  malformed(),
  malformed(),
  wellFormed('real', 'Real'),
];

/** Same entries, malformed ones last: the slice never reaches them. */
const MALFORMED_LAST: Opt[] = [
  wellFormed('real', 'Real'),
  malformed(),
  malformed(),
  malformed(),
];

/**
 * Two malformed entries then five well-formed ones. Chosen so BOTH counters
 * are non-zero and they disagree: slicing first renders one badge and claims
 * `+6`; filtering first renders three and claims `+2`. An assertion on `+2`
 * therefore discriminates instead of merely observing an absence.
 */
const TWO_MALFORMED_THEN_FIVE: Opt[] = [
  malformed(),
  malformed(),
  wellFormed('w1', 'Willow'),
  wellFormed('w2', 'Walnut'),
  wellFormed('w3', 'Wisteria'),
  wellFormed('w4', 'Wattle'),
  wellFormed('w5', 'Wormwood'),
];

/** No malformed entries at all — the control population. */
const ALL_WELL_FORMED: Opt[] = [
  wellFormed('a', 'Alder'),
  wellFormed('b', 'Birch'),
  wellFormed('c', 'Cedar'),
  wellFormed('d', 'Dogwood'),
  wellFormed('e', 'Elm'),
  wellFormed('f', 'Fir'),
];

/** Fewer entries than the multi-value slice budget of three. */
const SHORTER_THAN_BUDGET: Opt[] = [wellFormed('a', 'Alder'), wellFormed('b', 'Birch')];

/** Any `+N` the overflow counter may have rendered, whatever the number. */
const ANY_OVERFLOW = /^\+\d+$/;

describe('FieldStub picklist preview — a well-formed option behind malformed ones', () => {
  it('renders the well-formed option in the multi-value card', () => {
    render(<FieldStub type="multiselect" options={MALFORMED_FIRST} />);
    expect(screen.getByText('Real')).toBeTruthy();
    // The empty-state placeholder is what the card reported seeing instead.
    expect(screen.queryByText('Pick one or more…')).toBeNull();
  });

  it('renders the well-formed option in the single-value card', () => {
    render(<FieldStub type="select" options={MALFORMED_FIRST} />);
    expect(screen.getByText('Real')).toBeTruthy();
    expect(screen.queryByText('Select…')).toBeNull();
  });

  it('spends the whole budget on surviving options, not on malformed ones', () => {
    render(<FieldStub type="multiselect" options={TWO_MALFORMED_THEN_FIVE} />);
    // All three multi-value slots go to options that can actually render.
    expect(screen.getByText('Willow')).toBeTruthy();
    expect(screen.getByText('Walnut')).toBeTruthy();
    expect(screen.getByText('Wisteria')).toBeTruthy();
    // The budget is three, so the fourth survivor stays off the card.
    expect(screen.queryByText('Wattle')).toBeNull();
  });

  it('positional contrast: the same option with the malformed entries LAST always rendered', () => {
    render(<FieldStub type="multiselect" options={MALFORMED_LAST} />);
    expect(screen.getByText('Real')).toBeTruthy();
  });
});

describe('FieldStub picklist preview — the +N overflow counter', () => {
  it('counts the options that survived filtering and were not rendered', () => {
    render(<FieldStub type="multiselect" options={TWO_MALFORMED_THEN_FIVE} />);
    // Five options survive the filter and three fit, so the counter says two.
    expect(screen.getByText('+2')).toBeTruthy();
    // Not `+6`: that is what the slice-first order claimed, counting the two
    // malformed entries and the four options it never reached.
    expect(screen.queryByText('+6')).toBeNull();
  });

  it('drops the counter entirely when every surviving option is on screen', () => {
    render(<FieldStub type="multiselect" options={MALFORMED_FIRST} />);
    // Reported as `+4` before the repair: four authored entries, nothing on
    // screen. Deliberately asserts nothing about `Real` — that belongs to the
    // other half, and mixing them would stop either from failing on its own.
    expect(screen.queryByText(ANY_OVERFLOW)).toBeNull();
  });
});

describe('FieldStub picklist preview — control: no malformed options', () => {
  it('renders and counts a well-formed multi-value picklist exactly as before', () => {
    render(<FieldStub type="multiselect" options={ALL_WELL_FORMED} />);
    expect(screen.getByText('Alder')).toBeTruthy();
    expect(screen.getByText('Birch')).toBeTruthy();
    expect(screen.getByText('Cedar')).toBeTruthy();
    expect(screen.queryByText('Dogwood')).toBeNull();
    expect(screen.getByText('+3')).toBeTruthy();
  });

  it('renders a well-formed single-value picklist exactly as before', () => {
    render(<FieldStub type="select" options={ALL_WELL_FORMED} />);
    expect(screen.getByText('Alder')).toBeTruthy();
    expect(screen.queryByText('Birch')).toBeNull();
  });

  it('shows no +N at all when the picklist is shorter than the slice budget', () => {
    render(<FieldStub type="multiselect" options={SHORTER_THAN_BUDGET} />);
    expect(screen.getByText('Alder')).toBeTruthy();
    expect(screen.getByText('Birch')).toBeTruthy();
    expect(screen.queryByText(ANY_OVERFLOW)).toBeNull();
  });
});
