// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — the pure half of the design mode's 「Header buttons」:
 * what the panel shows (the object's arm, else the header's own first three
 * pinned and the rest in their default order), what it offers, the names an
 * arm sets that the scope no longer offers, the toggle with its limit of
 * three, the reorder, and the save's refusal of a name the scope cannot draw.
 */

import { describe, expect, it } from 'vitest';
import {
  PIN_LIMIT,
  defaultPins,
  headerReadsPins,
  movePin,
  pinCandidates,
  pinsChangeKey,
  pinsRefusal,
  servedPins,
  shownArrangement,
  staleNames,
  togglePin,
} from '../designModeHeaderPins';

const ACTIONS = [
  { name: 'log_call', label: 'Log call', locations: ['record_more'] },
  { name: 'mark_won', label: 'Mark won', locations: ['record_header'], order: 2 },
  { name: 'convert', label: 'Convert', locations: ['record_header'], order: 1 },
  { name: 'clone', label: 'Clone', locations: ['record_header'], order: 3 },
  { name: 'share', label: 'Share', locations: ['record_header'], order: 4 },
  { name: 'archive', label: 'Archive', locations: ['record_header'], component: 'action:menu' },
  { name: 'mass_assign', label: 'Assign', locations: ['list_toolbar'] },
  { name: 'new_task', label: 'New task', locations: ['list_toolbar'], variant: 'primary' },
];

const TEXTS = { unknown: (n: string) => `unknown ${n}`, notPlaced: (n: string) => `not placed ${n}` };

describe('the header pins under the design mode (objectstack#36366)', () => {
  it('one staged change per object, both scopes in it', () => {
    expect(pinsChangeKey('crm_lead')).toBe('object-pins:crm_lead');
    expect(PIN_LIMIT).toBe(3);
  });

  it('reads the served arms, and nothing for an arm the object does not set', () => {
    expect(servedPins({ actionLayout: { record: { pinned: ['convert'] } } })).toEqual({ record: { pinned: ['convert'] } });
    expect(servedPins({ actionLayout: { list: { pinned: [] }, record: { pinned: ['a', 7], more: ['b'] } } })).toEqual({
      list: { pinned: [] },
      record: { pinned: ['a'], more: ['b'] },
    });
    expect(servedPins({})).toEqual({});
    expect(servedPins({ actionLayout: ['convert'] })).toEqual({});
    // The old per-page array, or an arm without `pinned`, is no arm.
    expect(servedPins({ actionLayout: { record: ['convert'], list: { more: ['x'] } } })).toEqual({});
  });

  it("with no arm set the panel shows the header's own first three: by order, record_header only, never an action:menu", () => {
    expect(defaultPins(ACTIONS, 'record')).toEqual(['convert', 'mark_won', 'clone']);
    expect(defaultPins(ACTIONS, 'list')).toEqual(['new_task', 'mass_assign']);
    const candidates = pinCandidates(ACTIONS, 'record', []);
    expect(shownArrangement({}, 'record', ACTIONS, candidates)).toEqual({
      pinned: ['convert', 'mark_won', 'clone'],
      more: ['log_call', 'archive', 'share'],
    });
    expect(shownArrangement({ record: { pinned: ['share'] } }, 'record', ACTIONS, candidates)).toEqual({
      pinned: ['share'],
      more: ['log_call', 'archive', 'convert', 'mark_won', 'clone'],
    });
    expect(shownArrangement({ record: { pinned: [] } }, 'record', ACTIONS, candidates).pinned).toEqual([]);
  });

  it("「More」 shows the arm's `more` first, in its order, then every other candidate in the default order", () => {
    const candidates = pinCandidates(ACTIONS, 'record', []);
    expect(
      shownArrangement({ record: { pinned: ['convert'], more: ['share', 'log_call', 'convert'] } }, 'record', ACTIONS, candidates),
    ).toEqual({ pinned: ['convert'], more: ['share', 'log_call', 'archive', 'mark_won', 'clone'] });
  });

  it('a name the arm sets that the scope no longer offers is left out, and listed', () => {
    const candidates = pinCandidates(ACTIONS, 'record', []);
    const pins = { record: { pinned: ['gone_action', 'convert'], more: ['mass_assign', 'clone'] } };
    expect(shownArrangement(pins, 'record', ACTIONS, candidates).pinned).toEqual(['convert']);
    expect(shownArrangement(pins, 'record', ACTIONS, candidates).more).not.toContain('mass_assign');
    expect(staleNames(pins, 'record', candidates)).toEqual(['gone_action', 'mass_assign']);
    expect(staleNames({ list: { pinned: ['$import'] } }, 'list', pinCandidates(ACTIONS, 'list', []))).toEqual([]);
    expect(staleNames({}, 'record', candidates)).toEqual([]);
  });

  it("offers the page's placed actions in the header's order, then the built-ins the page has", () => {
    const builtins = [
      { id: '$import', label: 'Import' },
      { id: '$export', label: 'Export' },
    ];
    expect(pinCandidates(ACTIONS, 'record', builtins).map((c) => c.id)).toEqual([
      'log_call',
      'archive',
      'convert',
      'mark_won',
      'clone',
      'share',
    ]);
    expect(pinCandidates(ACTIONS, 'list', builtins).map((c) => c.id)).toEqual(['new_task', 'mass_assign', '$import', '$export']);
  });

  it('a toggle pins at the end, and unpins to the top of 「More」; a fourth is refused (null)', () => {
    expect(togglePin({ pinned: ['a', 'b'], more: ['c', 'd'] }, 'c')).toEqual({ pinned: ['a', 'b', 'c'], more: ['d'] });
    expect(togglePin({ pinned: ['a', 'b', 'c'], more: ['d'] }, 'b')).toEqual({ pinned: ['a', 'c'], more: ['b', 'd'] });
    expect(togglePin({ pinned: ['a', 'b', 'c'], more: ['d'] }, 'd')).toBeNull();
  });

  it('a reorder moves one entry of a part; an index outside it changes nothing', () => {
    expect(movePin(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movePin(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  });

  it("the save refuses a name, in either part, that is no action of the object or one of the other scope", () => {
    const served = { actions: ACTIONS };
    expect(
      pinsRefusal(
        served,
        { record: { pinned: ['convert'], more: ['log_call'] }, list: { pinned: ['$export'], more: ['mass_assign', '$import'] } },
        TEXTS,
      ),
    ).toBeNull();
    expect(pinsRefusal(served, { record: { pinned: ['ghost'] } }, TEXTS)).toBe('unknown ghost');
    expect(pinsRefusal(served, { record: { pinned: [], more: ['ghost'] } }, TEXTS)).toBe('unknown ghost');
    expect(pinsRefusal(served, { list: { pinned: ['convert'] } }, TEXTS)).toBe('not placed convert');
    expect(pinsRefusal(served, { record: { pinned: [], more: ['mass_assign'] } }, TEXTS)).toBe('not placed mass_assign');
  });

  it('the synthesized header and placedActions read the pins; a header with its own list, or none, does not', () => {
    const page = (header: Record<string, unknown>) => ({ regions: [{ name: 'main', components: [{ type: 'page:header', properties: header }] }] });
    expect(headerReadsPins(null)).toBe(true);
    expect(headerReadsPins({ regions: [{ name: 'main', components: [{ type: 'record:details' }] }] })).toBe(true);
    expect(headerReadsPins(page({ placedActions: true }))).toBe(true);
    expect(headerReadsPins(page({ actions: ['convert', 'clone'] }))).toBe(false);
    expect(headerReadsPins(page({ subtitle: 'no actions' }))).toBe(false);
    expect(headerReadsPins({ header: { type: 'page:header', actions: [] } })).toBe(false);
  });
});
