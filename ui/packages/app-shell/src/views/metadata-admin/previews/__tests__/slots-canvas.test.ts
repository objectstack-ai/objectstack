import { describe, it, expect } from 'vitest';
import { SLOT_ORDER, slotsToRegions, regionsToSlots } from '../PageBlockCanvas';

describe('slotted page ↔ canvas regions', () => {
  it('surfaces all 6 canonical slots in order, normalising single components to arrays', () => {
    const slots = {
      highlights: { type: 'record:highlights' },
      alerts: [{ type: 'record:alert' }, { type: 'record:alert' }],
      details: { type: 'record:details' },
    };
    const regions = slotsToRegions(slots);
    expect(regions.map((r) => r.name)).toEqual([...SLOT_ORDER]);
    const byName = Object.fromEntries(regions.map((r) => [r.name, r.components]));
    expect(byName.highlights).toEqual([{ type: 'record:highlights' }]); // single → [single]
    expect(byName.alerts).toHaveLength(2); // array stays
    expect(byName.details).toEqual([{ type: 'record:details' }]);
    // The retired `tabs` slot is not surfaced (objectstack#27053).
    expect(byName.tabs).toBeUndefined();
    expect(byName.header).toEqual([]); // unoverridden slot → empty (inherited)
    expect(byName.discussion).toEqual([]);
  });

  it('regionsToSlots omits empty slots (inherited) and keeps filled ones as arrays', () => {
    const regions = [
      { name: 'header', components: [] },
      { name: 'highlights', components: [{ type: 'record:highlights' }] },
      { name: 'details', components: [] },
      { name: 'discussion', components: [{ type: 'record:discussion' }] },
    ];
    const slots = regionsToSlots(regions);
    expect(Object.keys(slots).sort()).toEqual(['discussion', 'highlights']); // empty omitted
    expect(slots.highlights).toEqual([{ type: 'record:highlights' }]);
  });

  it('round-trips: regionsToSlots(slotsToRegions(x)) keeps the overridden slots', () => {
    const slots = { highlights: { type: 'record:highlights' }, details: { type: 'record:details' } };
    const out = regionsToSlots(slotsToRegions(slots));
    expect(Object.keys(out).sort()).toEqual(['details', 'highlights']);
    expect(out.details).toEqual([{ type: 'record:details' }]);
  });
});
