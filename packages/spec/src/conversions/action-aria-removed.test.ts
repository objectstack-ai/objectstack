// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ActionSchema } from '../ui/action.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * [#20323] `action-aria-removed` — the D2 half of the `action.aria` retirement.
 *
 * The fixture pair in `conversions.test.ts` already proves before → after over
 * the whole table. What it cannot express, and what this file pins:
 *
 *   - FIRING on both authored coordinates (`actions[]` and
 *     `objects[].actions[]`), each with its own notice path;
 *   - the CONTROL: an action that carries no `aria` comes back as the SAME
 *     reference — the strip touches nothing else, so the rendered behaviour
 *     (which never read the key) is preserved exactly;
 *   - IDEMPOTENCE: the converted result replays to itself with no second
 *     notice (`stripKeys` skips an absent key, by construction — asserted here
 *     rather than assumed);
 *   - that the strip lands where a consumer reads it: the result parses
 *     against `ActionSchema`, and the stored-row seam replays it (the entry is
 *     `retiredFromLoadPath`, so only data-at-rest seams apply it).
 */
describe('action-aria-removed (ADR-0087 D2)', () => {
  const ARIA = { ariaLabel: 'Escalate this case', role: 'button' } as const;

  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === 'action-aria-removed');
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('fires on a stack action and on an object-nested action, one notice per site', () => {
    const { stack, notices } = collectConversionNotices(
      {
        actions: [{ name: 'escalate_case', label: 'Escalate', type: 'script', aria: ARIA }],
        objects: [{
          name: 'support_case',
          label: 'Case',
          actions: [{ name: 'reopen_case', label: 'Reopen', type: 'script', aria: { ariaDescribedBy: 'x' } }],
        }],
      },
      { includeRetired: true },
    );
    const mine = notices.filter((n) => n.conversionId === 'action-aria-removed');
    expect(mine.map((n) => n.path).sort()).toEqual([
      'actions[0].aria',
      'objects[0].actions[0].aria',
    ]);
    for (const n of mine) {
      expect(n.from).toBe('aria');
      expect(n.to).toBe('(removed)');
    }
    const s = stack as { actions: Record<string, unknown>[]; objects: { actions: Record<string, unknown>[] }[] };
    expect(s.actions[0]).not.toHaveProperty('aria');
    expect(s.objects[0].actions[0]).not.toHaveProperty('aria');
    // Everything else on the action survives verbatim.
    expect(s.actions[0]).toEqual({ name: 'escalate_case', label: 'Escalate', type: 'script' });
  });

  it('control: an action without `aria` is returned as the same reference, with no notice', () => {
    const clean = {
      actions: [{ name: 'close_case', label: 'Close', type: 'script', icon: 'check' }],
      objects: [{ name: 'support_case', label: 'Case', actions: [{ name: 'reopen_case', label: 'Reopen' }] }],
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out, 'nothing to strip ⇒ copy-on-write returns the input').toBe(clean);
    expect(notices.filter((n) => n.conversionId === 'action-aria-removed')).toEqual([]);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions(
      { actions: [{ name: 'escalate_case', label: 'Escalate', type: 'script', aria: ARIA }] },
      { includeRetired: true },
    );
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });

  it('the stored-row seam replays it, and the result parses against `ActionSchema`', () => {
    const stored = { name: 'escalate_case', label: 'Escalate', type: 'script', target: 'escalateCase', aria: ARIA };
    // Before: the retired key is refused at parse — the row a pre-retirement
    // author left behind would be badged invalid without the replay.
    expect(ActionSchema.safeParse(stored).success).toBe(false);
    const converted = applyConversionsToStoredItem('action', stored);
    expect(converted).not.toHaveProperty('aria');
    expect(ActionSchema.safeParse(converted).success).toBe(true);
  });

  it('the stored-row seam reaches an `object` row\'s nested action too', () => {
    // The second authored coordinate at rest: an `object` row wraps as
    // `objects[0]`, so the walk reaches `objects[].actions[]`. Everything but
    // the retired key survives, and the untouched sibling action is the SAME
    // reference (copy-on-write).
    const untouched = { name: 'close_case', label: 'Close', type: 'script', target: 'closeCase' };
    const stored = {
      name: 'support_case',
      label: 'Case',
      actions: [
        { name: 'reopen_case', label: 'Reopen', type: 'script', target: 'reopenCase', aria: ARIA },
        untouched,
      ],
    };
    const converted = applyConversionsToStoredItem('object', stored) as typeof stored;
    expect(converted.actions[0]).toEqual({ name: 'reopen_case', label: 'Reopen', type: 'script', target: 'reopenCase' });
    expect(converted.actions[1]).toBe(untouched);
    expect(converted.name).toBe('support_case');
  });
});
