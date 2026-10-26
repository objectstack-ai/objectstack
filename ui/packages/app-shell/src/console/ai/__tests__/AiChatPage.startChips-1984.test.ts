/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * cloud#1984 — the CALL-SITE half of the maker start chips.
 *
 * `packages/i18n/src/__tests__/makerStartChips-v1-scope-1984.test.ts` guards
 * the ten packs. This guards the other copy of the same five strings: the
 * `defaultValue` fallbacks in `metadataAssistantSuggestions()`, which are what
 * a host with no I18nProvider (and any locale that ever loses the key)
 * actually renders. Two copies of one string is exactly where a scope fix gets
 * applied to one of them — the packs were reworded for ADR-0112 v1 and the
 * fallbacks would have kept promising a status workflow and low-stock
 * visibility, invisibly, on precisely the surface with the least i18n.
 *
 * So: byte-equality with the `en` pack, and the same automation-vocabulary ban.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '@object-ui/i18n/locales';
import { buildAgentSuggestions } from '../AiChatPage.js';

/** A `t` that misses every key — i.e. what a provider-less host resolves. */
const missEverything = (_key: string, options?: Record<string, unknown>): string =>
  String(options?.defaultValue ?? _key);

/** The `en` pack's chip block. */
const enChips = (
  builtInLocales.en as {
    console: { ai: { suggestions: { metadataAssistant: Record<string, string> } } };
  }
).console.ai.suggestions.metadataAssistant;

const CHIP_KEYS = ['buildCrm', 'buildApp', 'buildFlow', 'buildInventory', 'buildRecruiting'] as const;

/** The English half of the i18n suite's banned vocabulary. @see makerStartChips-v1-scope-1984 */
const BANNED_EN = ['alert', 'remind', 'notif', 'automat', 'workflow', 'trigger', 'schedule'];

describe('metadataAssistantSuggestions — the build agent`s five start chips (cloud#1984)', () => {
  it('renders the five authoring starters for the build agent', () => {
    const chips = buildAgentSuggestions('build', 'Build', missEverything);
    expect(chips).toHaveLength(5);
  });

  it('every `defaultValue` is byte-equal to the en pack', () => {
    const chips = buildAgentSuggestions('build', 'Build', missEverything);
    expect(chips).toEqual(CHIP_KEYS.map((k) => enChips[k]));
  });

  it('no fallback promises autonomous behaviour', () => {
    for (const chip of buildAgentSuggestions('build', 'Build', missEverything)) {
      const hits = BANNED_EN.filter((term) => chip.toLowerCase().includes(term));
      expect(hits, chip).toEqual([]);
    }
  });

  it('the control: the retired wording WOULD have been flagged', () => {
    // Non-vacuity, same reasoning as the pack-side suite: a banned list that
    // has stopped matching anything passes the assertion above in silence.
    const retired = 'Design a support desk — tickets with priority, a status workflow, and customer links.';
    expect(BANNED_EN.filter((term) => retired.toLowerCase().includes(term))).toContain('workflow');
  });
});
