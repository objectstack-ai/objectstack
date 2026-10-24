/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The locale tripwire's own controls (objectui#9786, objectui#9909).
 *
 * Every differential pin that imports the tripwire asserts "no machine-locale
 * call was observed", which an instrument that observes NOTHING satisfies
 * perfectly. These cases are what make that assertion a reading: the
 * instrument sees a machine-locale call on each API family it patches, it
 * passes a call that states its tag, and it restores every intrinsic after a
 * throwing body.
 */

import { describe, it, expect } from 'vitest';
import { isMachineLocale, recordLocaleArguments, recordLocaleArgumentsAsync } from '../locale-tripwire';

const STORED = '2020-03-04T15:30:00.000Z';

describe('the locale tripwire observes the argument each call received', () => {
  it('sees a machine-locale call on every API family it patches', () => {
    const calls = recordLocaleArguments(() => {
      new Date(STORED).toLocaleDateString();
      new Date(STORED).toLocaleString(undefined, { dateStyle: 'medium' });
      new Date(STORED).toLocaleTimeString();
      (1234.5).toLocaleString();
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(STORED));
      new Intl.NumberFormat().format(1234.5);
    });
    expect(calls.filter(isMachineLocale).map((c) => c.api)).toEqual([
      'Date.prototype.toLocaleDateString',
      'Date.prototype.toLocaleString',
      'Date.prototype.toLocaleTimeString',
      'Number.prototype.toLocaleString',
      'Intl.DateTimeFormat',
      'Intl.NumberFormat',
    ]);
  });

  /**
   * `Number.prototype.toLocaleString` does NOT go through the global
   * `Intl.NumberFormat`: the engine reaches its own intrinsic. An instrument
   * that patched only `Intl` would record NOTHING for `n.toLocaleString()` —
   * half of objectui#9909's population is number faces.
   */
  it('observes a number face through Number.prototype, not through Intl', () => {
    const calls = recordLocaleArguments(() => {
      (1234.5).toLocaleString('de-DE');
    });
    expect(calls).toEqual([{ api: 'Number.prototype.toLocaleString', locale: 'de-DE', argc: 1 }]);
  });

  it('passes a call that states its tag', () => {
    const calls = recordLocaleArguments(() => {
      new Date(STORED).toLocaleDateString('de-DE');
      new Intl.NumberFormat('en').format(1);
    });
    expect(calls.filter(isMachineLocale)).toEqual([]);
    expect(calls.map((c) => c.locale)).toEqual(['de-DE', 'en']);
  });

  /**
   * ⚠️ The disguise: `'default'` is a well-formed subtag no locale data
   * answers, so `Intl` resolves it to the runtime default. Asserted from the
   * engine's side as well, so the classification is a measurement of THIS
   * runtime rather than a belief about it.
   */
  it("counts the 'default' pseudo-tag as the machine locale", () => {
    expect(new Intl.DateTimeFormat('default').resolvedOptions().locale).toBe(
      new Intl.DateTimeFormat().resolvedOptions().locale,
    );
    const calls = recordLocaleArguments(() => {
      new Date(STORED).toLocaleString('default', { month: 'short' });
    });
    expect(calls.filter(isMachineLocale).map((c) => c.locale)).toEqual(['default']);
  });

  it('restores every intrinsic, including after a throwing body', () => {
    const before = {
      dtf: Intl.DateTimeFormat,
      nf: Intl.NumberFormat,
      date: Date.prototype.toLocaleDateString,
      num: Number.prototype.toLocaleString,
    };
    expect(() =>
      recordLocaleArguments(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(Intl.DateTimeFormat).toBe(before.dtf);
    expect(Intl.NumberFormat).toBe(before.nf);
    expect(Date.prototype.toLocaleDateString).toBe(before.date);
    expect(Number.prototype.toLocaleString).toBe(before.num);
  });

  it('keeps observing across an awaited body', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await Promise.resolve();
      new Date(STORED).toLocaleDateString();
    });
    expect(calls.filter(isMachineLocale).map((c) => c.api)).toEqual(['Date.prototype.toLocaleDateString']);
    expect(Date.prototype.toLocaleDateString.name).toBe('toLocaleDateString');
  });
});
