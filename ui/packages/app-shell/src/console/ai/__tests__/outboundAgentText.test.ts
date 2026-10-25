// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveOutboundAgentText` — the outbound half of the plan/confirm-card
 * language gate (objectui#3896).
 *
 * The invariant: what a card SENDS is a function of the CONVERSATION's language
 * and nothing else. There is deliberately no `I18nProvider` in this file — a UI
 * locale cannot even be expressed here, which is the strongest statement of the
 * rule the unit level can make. `AiChatPage.planCardLocale.test.tsx` then pins
 * the same four strings through a real provider, where a UI locale exists and
 * could still leak in.
 *
 * Gate conformance is NOT re-asserted here: the cloud `APPROVAL_RE` mirror lives
 * in `packages/i18n/src/__tests__/i18n.test.ts` and pins the `zh`/`en` PACK
 * values against it. This file pins that the resolver hands back exactly those
 * pack values, which is the other link of that chain.
 */

import { describe, it, expect } from 'vitest';
import { en, zh } from '@object-ui/i18n/locales';
import {
  OUTBOUND_GATE_TEXT,
  resolveOutboundAgentText,
  type OutboundAgentTextKey,
} from '../outboundAgentText';

const KEYS = [
  'planApproveMessage',
  'planApproveDefaultsMessage',
  'planAnswerMessage',
  'changesConfirmMessage',
] as const;

function packValue(pack: unknown, key: OutboundAgentTextKey): unknown {
  return (pack as { console: { ai: Record<string, unknown> } }).console.ai[key];
}

describe('outbound agent text follows the conversation, never the UI locale (#3896)', () => {
  it('covers every outbound key the i18n guard owns — no silent shrink', () => {
    // Mirrors OUTBOUND_KEYS in packages/i18n/src/__tests__/outbound-agent-messages.test.ts.
    expect(Object.keys(OUTBOUND_GATE_TEXT).sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)('a Chinese conversation gets the zh pack value for %s', (key) => {
    expect(resolveOutboundAgentText(true, key)).toBe(packValue(zh, key));
  });

  it.each(KEYS)('a non-Chinese conversation gets the en pack value for %s', (key) => {
    // The defect: this branch used to be `t(key)`, i.e. the UI pack — so a zh
    // console answered a non-Chinese conversation in Chinese.
    expect(resolveOutboundAgentText(false, key)).toBe(packValue(en, key));
  });

  it.each(KEYS)('the two answers for %s really differ, so the pin can discriminate', (key) => {
    expect(resolveOutboundAgentText(true, key)).not.toBe(resolveOutboundAgentText(false, key));
  });

  it.each(KEYS)('the last-resort wording for %s mirrors both packs byte for byte', (key) => {
    // If a pack ever stops defining the key the resolver falls back to this
    // table, and a Chinese conversation must fall back to CHINESE. Pinning the
    // mirror is what keeps that fallback gate-correct instead of stale.
    expect(OUTBOUND_GATE_TEXT[key].zh).toBe(packValue(zh, key));
    expect(OUTBOUND_GATE_TEXT[key].en).toBe(packValue(en, key));
  });

  describe('planAnswerMessage placeholders', () => {
    it('fills question and option in a Chinese conversation', () => {
      expect(
        resolveOutboundAgentText(true, 'planAnswerMessage', {
          question: '一个货架还是多个？',
          option: '多个',
        }),
      ).toBe('关于「一个货架还是多个？」，我选择「多个」。');
    });

    it('fills question and option in an English conversation', () => {
      expect(
        resolveOutboundAgentText(false, 'planAnswerMessage', {
          question: 'One shelf or many?',
          option: 'many',
        }),
      ).toBe('For "One shelf or many?", go with: many.');
    });

    it('leaves an unsupplied placeholder visible instead of blanking it', () => {
      // A silently-dropped placeholder would send a truncated question to the
      // agent; leaving the token makes the bug legible in the thread itself.
      expect(resolveOutboundAgentText(false, 'planAnswerMessage', { question: 'Q' })).toBe(
        'For "Q", go with: {{option}}.',
      );
    });

    it('does not interpolate when no variables are supplied', () => {
      expect(resolveOutboundAgentText(false, 'planAnswerMessage')).toBe(packValue(en, 'planAnswerMessage'));
    });
  });
});
