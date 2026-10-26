/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7709 — the CALL-SITE half of the maker's EDIT-mode chips.
 *
 * `packages/i18n/src/__tests__/makerEditChips-v1-scope-7709.test.ts` guards the
 * ten packs. This guards the other copy of the same four strings: the
 * `defaultValue` fallbacks in `editAppSuggestions()`, which are what a host
 * with no I18nProvider (and any locale that ever loses the key) actually
 * renders. cloud#1984 measured that shape on the sibling family — the packs
 * were reworded and the fallbacks kept promising a status workflow, invisibly,
 * on precisely the surface with the least i18n — so the two copies are pinned
 * to each other here rather than trusted to stay in step.
 *
 * So: the edit-mode branch is reached at all, byte-equality with the `en` pack,
 * and the same automation/approval-vocabulary ban.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '@object-ui/i18n/locales';
import { buildAgentSuggestions } from '../AiChatPage.js';

/** A `t` that misses every key — i.e. what a provider-less host resolves. */
const missEverything = (_key: string, options?: Record<string, unknown>): string =>
  String(options?.defaultValue ?? _key);

/** The `en` pack's edit-mode chip block. */
const enChips = (
  builtInLocales.en as {
    console: { ai: { suggestions: { editApp: Record<string, string> } } };
  }
).console.ai.suggestions.editApp;

const CHIP_KEYS = ['addField', 'addObject', 'addDashboard', 'addSampleData'] as const;

/** The English half of the i18n suite's banned vocabulary. @see makerEditChips-v1-scope-7709 */
const BANNED_EN = ['alert', 'remind', 'notif', 'automat', 'workflow', 'trigger', 'schedule', 'approv'];

const editChips = () => buildAgentSuggestions('build', 'Build', missEverything, true);

describe('editAppSuggestions — the build agent`s four edit-mode chips (objectui#7709)', () => {
  it('renders the edit-mode starters when the surface is bound to an app', () => {
    const chips = editChips();
    expect(chips).toHaveLength(4);
    // The `editing` flag is what selects this family; without it the from-
    // scratch five are rendered and this suite would be guarding nothing.
    expect(buildAgentSuggestions('build', 'Build', missEverything)).toHaveLength(5);
  });

  it('every `defaultValue` is byte-equal to the en pack', () => {
    expect(editChips()).toEqual(CHIP_KEYS.map((k) => enChips[k]));
  });

  it('no fallback promises autonomous behaviour', () => {
    for (const chip of editChips()) {
      const hits = BANNED_EN.filter((term) => chip.toLowerCase().includes(term));
      expect(hits, chip).toEqual([]);
    }
  });

  it('the control: the retired wording WOULD have been flagged', () => {
    // Non-vacuity, same reasoning as the pack-side suite: a banned list that
    // has stopped matching anything passes the assertion above in silence.
    const retired = 'Add an automation — an approval, a status flow, or a notification.';
    const hits = BANNED_EN.filter((term) => retired.toLowerCase().includes(term));
    expect(hits).toContain('automat');
    expect(hits).toContain('approv');
    expect(hits).toContain('notif');
  });
});
