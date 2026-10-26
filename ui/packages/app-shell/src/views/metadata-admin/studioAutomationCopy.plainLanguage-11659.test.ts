// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11659 ruling 6 — Studio's automation pillar speaks plain language
 * in zh.
 *
 * The cloud acceptance run read 「自动化 · flow」 over the automation list and
 * 「默认 OFF · 审阅后再启用」 in the pillar's top bar: an internal metadata type
 * and an English switch state, inside Chinese copy. This pins the property, not
 * the wording: no zh row the pillar's chrome reads carries the metadata type
 * `flow` or the English `ON` / `OFF`. The rows are read through the same `t()`
 * the pillar calls, and each is first checked to be a real zh row (not the key
 * echoed back, not the en row), so a missing row cannot pass.
 *
 * Out of this pin by design: the identifier placeholder's example
 * (`offer_notice`) and author data such as a flow's own name.
 */

import { describe, expect, it } from 'vitest';
import { t } from './i18n';

/** The automation pillar's chrome: every `engine.studio.auto.*` row it renders as prose. */
const PILLAR_ROWS = [
  'engine.studio.auto.heading',
  'engine.studio.auto.defaultOff',
  'engine.studio.auto.canvasHint',
  'engine.studio.auto.on',
  'engine.studio.auto.off',
  'engine.studio.auto.offTitle',
  'engine.studio.auto.onBound',
  'engine.studio.auto.onUnbound',
  // objectui#11779 — the run status's "not running here" and "not deployed" words.
  'engine.studio.auto.notRunning',
  'engine.studio.auto.notRunningTitle',
  'engine.studio.auto.unpublishedTitle',
  'engine.studio.auto.enabled',
  'engine.studio.auto.disabled',
  'engine.studio.auto.enableTitle',
  'engine.studio.auto.disableTitle',
  'engine.studio.auto.enabledToast',
  'engine.studio.auto.disabledToast',
  'engine.studio.auto.newTitle',
  'engine.studio.auto.none',
  'engine.studio.auto.emptyMain',
  'engine.studio.auto.config',
  'engine.studio.auto.emptyLine1',
  'engine.studio.auto.emptyLine2',
  'engine.studio.auto.savedDraft',
] as const;

/** ASCII tokens that are internal vocabulary inside zh copy. `\b` holds next to CJK, which is not `\w`. */
const INTERNAL_TOKENS = [/\bflow\b/i, /\bOFF\b/, /\bON\b/];

describe('Studio automation pillar — zh copy is plain language (objectui#11659)', () => {
  it('every pillar row is a real zh row', () => {
    for (const key of PILLAR_ROWS) {
      const zh = t(key, 'zh-CN');
      expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
      expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
    }
  });

  it('no zh pillar row carries the metadata type `flow` or an English ON/OFF', () => {
    const offenders = PILLAR_ROWS.flatMap((key) => {
      const zh = t(key, 'zh-CN');
      return INTERNAL_TOKENS.filter((re) => re.test(zh)).map((re) => `${key}: ${re} in 「${zh}」`);
    });
    expect(offenders).toEqual([]);
  });

  it('the regexes see the tokens they are meant to catch (positive control)', () => {
    expect(INTERNAL_TOKENS[0].test('自动化 · flow')).toBe(true);
    expect(INTERNAL_TOKENS[1].test('默认 OFF · 审阅后再启用')).toBe(true);
    expect(INTERNAL_TOKENS[1].test('默认OFF')).toBe(true);
    expect(INTERNAL_TOKENS[2].test('已 ON')).toBe(true);
  });

  it('the en heading names the pillar without the metadata type', () => {
    expect(t('engine.studio.auto.heading', 'en-US')).not.toMatch(/\bflow\b/i);
  });
});
