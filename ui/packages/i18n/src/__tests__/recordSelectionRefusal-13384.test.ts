/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13384 — the two row-count refusals of a single-record action have a
 * pack key in every shipped pack.
 *
 * `@object-ui/core`'s `resolveServerActionRecordId` writes them, with their
 * keys (`actions.selectExactlyOneRow`, `actions.selectRowFirst`), and the
 * action runner asks its translator for them by those keys before any dialog
 * opens (pinned in core's `ActionRunner.recordRowGuard-13384` suite). Under a
 * zh-CN session the refusal used to read English, since neither string had a
 * key. The zh-CN words are pinned here; every other pack is held to defining
 * both keys with its own text.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

const KEYS = ['selectExactlyOneRow', 'selectRowFirst'] as const;

const actionsOf = (pack: unknown) => (pack as { actions: Record<string, unknown> }).actions;

describe('objectui#13384 — the row-count refusals are translated', () => {
  it('zh-CN reads them in Chinese', () => {
    expect(actionsOf(builtInLocales.zh).selectExactlyOneRow).toBe('此操作针对单条记录，请只选择一行。');
    expect(actionsOf(builtInLocales.zh).selectRowFirst).toBe('此操作针对单条记录，请先选择一行。');
  });

  it('en holds the English source core falls back to', () => {
    expect(actionsOf(builtInLocales.en).selectExactlyOneRow)
      .toBe('This action runs on a single record — select exactly one row.');
    expect(actionsOf(builtInLocales.en).selectRowFirst)
      .toBe('This action runs on a single record — select a row first.');
  });

  for (const [code, pack] of Object.entries(builtInLocales)) {
    if (code === 'en') continue;
    it(`${code} defines both keys with its own text`, () => {
      for (const key of KEYS) {
        const value = actionsOf(pack)[key];
        expect(typeof value, `${code} actions.${key}`).toBe('string');
        expect((value as string).trim(), `${code} actions.${key}`).not.toBe('');
        expect(value, `${code} actions.${key}`).not.toBe(actionsOf(builtInLocales.en)[key]);
      }
    });
  }
});
