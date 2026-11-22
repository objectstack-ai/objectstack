// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — the pure half of the design mode's 「Header buttons」:
 * what the panel shows as pinned (the object's arm, else the header's own
 * first three), what it offers, the toggle with its limit of three, the
 * reorder, and the save's refusal of a name the header cannot draw.
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
  shownPins,
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
  it('one staged change per object, both pages in it', () => {
    expect(pinsChangeKey('crm_lead')).toBe('object-pins:crm_lead');
    expect(PIN_LIMIT).toBe(3);
  });

  it('reads the served arms, and nothing for an arm the object does not set', () => {
    expect(servedPins({ pinnedActions: { record: ['convert'] } })).toEqual({ record: ['convert'] });
    expect(servedPins({ pinnedActions: { list: [], record: ['a', 7] } })).toEqual({ list: [], record: ['a'] });
    expect(servedPins({})).toEqual({});
    expect(servedPins({ pinnedActions: ['convert'] })).toEqual({});
  });

  it("with no arm set the panel shows the header's own first three: by order, record_header only, never an action:menu", () => {
    expect(defaultPins(ACTIONS, 'record')).toEqual(['convert', 'mark_won', 'clone']);
    expect(defaultPins(ACTIONS, 'list')).toEqual(['new_task', 'mass_assign']);
    expect(shownPins({}, 'record', ACTIONS)).toEqual(['convert', 'mark_won', 'clone']);
    expect(shownPins({ record: ['share'] }, 'record', ACTIONS)).toEqual(['share']);
    expect(shownPins({ record: [] }, 'record', ACTIONS)).toEqual([]);
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

  it('a toggle pins at the end and unpins in place; a fourth is refused (null)', () => {
    expect(togglePin(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(togglePin(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(togglePin(['a', 'b', 'c'], 'd')).toBeNull();
  });

  it('a reorder moves one pin; an index outside the pins changes nothing', () => {
    expect(movePin(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movePin(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  });

  it("the save refuses a name that is no action of the object, or one not placed on the arm's page", () => {
    const served = { actions: ACTIONS };
    expect(pinsRefusal(served, { record: ['convert', 'log_call'], list: ['$export', 'mass_assign'] }, TEXTS)).toBeNull();
    expect(pinsRefusal(served, { record: ['ghost'] }, TEXTS)).toBe('unknown ghost');
    expect(pinsRefusal(served, { list: ['convert'] }, TEXTS)).toBe('not placed convert');
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
