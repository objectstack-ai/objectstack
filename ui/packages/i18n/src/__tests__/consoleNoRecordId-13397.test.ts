/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13397 — the console server-action wrapper's `newTabUrl` refusal
 * ("no record id available") has a pack key, `console.serverAction.noRecordId`,
 * in every shipped pack. `createConsoleServerActionHandler` used to return it
 * as a hard-coded English string. The zh-CN words are pinned here; every other
 * pack is held to defining the key with its own text.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

const noRecordIdOf = (pack: unknown) =>
  (pack as { console: { serverAction: Record<string, unknown> } }).console.serverAction.noRecordId;

describe('objectui#13397 — the newTabUrl "no record id" refusal is translated', () => {
  it('zh-CN reads it in Chinese', () => {
    expect(noRecordIdOf(builtInLocales.zh)).toBe('此操作针对单条记录，但没有可用的记录 ID。');
  });

  it('en holds the English source the wrapper falls back to', () => {
    expect(noRecordIdOf(builtInLocales.en)).toBe('This action runs on a single record — no record id available.');
  });

  for (const [code, pack] of Object.entries(builtInLocales)) {
    if (code === 'en') continue;
    it(`${code} defines it with its own text`, () => {
      const value = noRecordIdOf(pack);
      expect(typeof value, `${code} console.serverAction.noRecordId`).toBe('string');
      expect((value as string).trim(), `${code} console.serverAction.noRecordId`).not.toBe('');
      expect(value, `${code} console.serverAction.noRecordId`).not.toBe(noRecordIdOf(builtInLocales.en));
    });
  }
});
