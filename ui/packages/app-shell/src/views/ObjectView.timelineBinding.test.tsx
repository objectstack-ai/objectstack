/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3129 — the object page must not invent a timeline date axis.
 *
 * This face used to emit `startDateField: 'due_date'` into `options.timeline`
 * for EVERY object view, declared or not. Downstream that is indistinguishable
 * from a real binding, and because it is always present it shadowed the
 * calendar binding `ListView.resolveTimelineDateBinding` falls back to — so a
 * calendar-bound view rendered as a timeline bucketed every record into
 * "No date" (the reported symptom), while the calendar rendered the same field
 * correctly.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `startDateField: viewDef.timeline?.startDateField || … || 'due_date'`
 * in `timelineViewOptions` and the two "does not invent" cases below go RED
 * (they read `'due_date'`), while every other case in this file and in
 * `ListView.timeline-binding.test.tsx` stays green — the fabricated value is
 * only ever observable when the view declared nothing.
 *
 * FIXTURE TRIAGE (objectui#6557). The shared `objectDef` here used to be
 * `{ name: 'crm_campaign', titleField: 'name' }`, and the no-timeline-config
 * case below asserted `out.titleField === 'name'` while its comment credited
 * the OBJECT with supplying it. That fixture pinned nothing: `'name'` is also
 * the literal floor, so the assertion resolved identically with the object leg
 * deleted — and the key itself is one `@objectstack/spec`'s `strictObject`
 * REJECTS (`unrecognized_keys`), so no legal object could carry it. The leg is
 * gone and the function now takes only `viewDef`; what the object-level key
 * does NOT do is pinned with a DISTINGUISHABLE value in
 * `ObjectView.titleFieldConvergence.test.tsx`, where `'name'`-vs-`'headline'`
 * can actually tell the two worlds apart.
 */

import { describe, it, expect } from 'vitest';
import { timelineViewOptions } from './ObjectView';

describe('timelineViewOptions — the object page forwards, it does not resolve (#3129)', () => {
  it('forwards a declared spec binding untouched', () => {
    const out = timelineViewOptions({
      timeline: { startDateField: 'start_date', endDateField: 'end_date', scale: 'month' },
    });
    expect(out.startDateField).toBe('start_date');
    expect(out.endDateField).toBe('end_date');
    // Every spec key survives — the whole config is spread, not whitelisted.
    expect(out.scale).toBe('month');
  });

  it('does NOT promote the retired `dateField` alias onto the spec key (objectui#6152 round 14)', () => {
    // It used to: this face resolved `startDateField || dateField`. Every
    // list-view door refuses the alias by name and `ListView` no longer reads
    // it either, so the relay restates the spec key alone.
    expect(timelineViewOptions({ timeline: { dateField: 'start_date' } }).startDateField)
      .toBeUndefined();
  });

  it('invents NO date field when the view declares none', () => {
    const out = timelineViewOptions({ timeline: { titleField: 'campaign_name' } });
    expect(out.startDateField).toBeUndefined();
    expect(out.titleField).toBe('campaign_name');
  });

  it('invents NO date field for a view with no timeline config at all', () => {
    // The calendar-bound view from the report: the axis lives under `calendar`,
    // and leaving `startDateField` absent here is what lets ListView find it.
    const out = timelineViewOptions({ calendar: { startDateField: 'start_date' } });
    expect(out.startDateField).toBeUndefined();
    // With no timeline config at all there is nothing to forward, so the
    // literal floor answers — the same two-rung shape the calendar and gantt
    // branches of this page have always used.
    expect(out.titleField).toBe('name');
  });

  it("falls back to 'name' when the view declares no titleField", () => {
    expect(timelineViewOptions({}).titleField).toBe('name');
  });
});
