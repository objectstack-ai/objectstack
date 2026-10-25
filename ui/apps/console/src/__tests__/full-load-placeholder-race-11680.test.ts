/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A full console load logs no bare-name race warning (objectui#11680).
 *
 * This replays the boot `main.tsx` performs: the REAL stub list
 * (`../register-plugins`), then the real `registerPlaceholders()`. The
 * placeholder registrar used to read a key held by a pending stub as free, so
 * it raced the console's `view:calendar` and `view:timeline` stubs on every
 * boot. Reading the real list is what makes this pin catch the NEXT console
 * stub on a protocol key, which a replay of two named keys cannot.
 *
 * The capture is installed in `vi.hoisted`, ahead of the imports, because the
 * stubs register while `../register-plugins` is imported.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const race = vi.hoisted(() => {
  const original = console.warn;
  const seen: string[] = [];
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('bare-name fallback is being overwritten')) seen.push(args[0]);
    else original(...args);
  };
  return { seen, restore: () => { console.warn = original; } };
});

import { ComponentRegistry } from '@object-ui/core';
import '../register-plugins';
import { registerPlaceholders } from '@object-ui/components';

afterAll(() => race.restore());

describe('a full console load logs no bare-name race warning (objectui#11680)', () => {
  it('declaring the stubs, then registering the placeholders, races nothing', () => {
    const stubbed = ComponentRegistry.getKnownTypes().filter((key) => ComponentRegistry.hasLazy(key));
    registerPlaceholders();

    expect(race.seen, 'a registration took a bare key another declaration holds').toEqual([]);
    // Positive control: the placeholders left every stub where it was, the two
    // the card measured among them, so the silence above covers those keys.
    expect(stubbed).toEqual(expect.arrayContaining(['view:calendar', 'view:timeline']));
    expect(stubbed.filter((key) => !ComponentRegistry.hasLazy(key))).toEqual([]);
  });
});
