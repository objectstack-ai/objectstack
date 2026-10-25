// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Guard: the strings the console SENDS to the AI agent must not be translated
 * into arbitrary locales.
 *
 * Most `console.ai.*` keys are labels and should be localized everywhere. Four
 * are not labels — they are the message text a button transmits to the agent,
 * and the cloud confirm gate (`service-ai-studio` `confirm-gate.ts`
 * `APPROVAL_RE`) decides whether that text counts as approval. It recognises
 * Chinese and English. Nothing else.
 *
 * So `AiChatPage` picks them by the language of the CONVERSATION, not the UI —
 * since objectui#3896 through one resolver
 * (`packages/app-shell/src/console/ai/outboundAgentText.ts`) that reads the two
 * gate packs directly and never calls `t()` for these four keys:
 *
 *     zh conversation -> the `zh` pack's value        // matches the gate
 *     anything else   -> the `en` pack's value        // matches the gate
 *
 * ## What this test guarantees, stated as what it asserts
 *
 * Exactly two packs define these keys: `en` and `zh`. That is the whole claim.
 * It is NOT "a `t()` lookup MISSes in every non-Chinese pack" — the wording this
 * header carried until #3896, which was false for `zh` and was the premise the
 * bug hid behind: `zh` defines all four, so the `t()` fallback HIT and a zh
 * console sent `确认，开始搭建。` into an English thread.
 *
 * ## Why the claim still earns its keep after #3896
 *
 * A translation added to a ninth pack is now DEAD rather than dangerous — the
 * resolver never reads that pack, so the value can never be sent, and an
 * unreachable pack value is its own defect class (objectui#3837). Before #3896
 * it was actively harmful: the value WAS sent, the gate stopped matching, the
 * agent re-proposed instead of building, and the button merely looked inert
 * while nothing visibly errored. objectui#2900 shipped exactly that for
 * `changesConfirmMessage`.
 *
 * If the gate ever learns more languages, teach the resolver in the same change
 * that deletes the offending entry here — not before.
 */
import { describe, it, expect } from 'vitest';
import { en, zh, ja, ko, de, fr, es, pt, ru, ar } from '../locales';

const OUTBOUND_KEYS = [
  'console.ai.planApproveMessage',
  'console.ai.planApproveDefaultsMessage',
  'console.ai.planAnswerMessage',
  'console.ai.changesConfirmMessage',
] as const;

const GATE_LOCALES: Record<string, unknown> = { en, zh };
const NON_GATE_LOCALES: Record<string, unknown> = { ja, ko, de, fr, es, pt, ru, ar };

function lookup(pack: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], pack);
}

describe('outbound agent messages stay on gate-recognised languages', () => {
  it.each(Object.keys(NON_GATE_LOCALES))(
    'the %s pack defines none of them — a value there could never be sent',
    (lang) => {
      const offenders = OUTBOUND_KEYS.filter(
        (k) => lookup(NON_GATE_LOCALES[lang], k) !== undefined,
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(Object.keys(GATE_LOCALES))('the %s pack defines all of them', (lang) => {
    // Both halves are load-bearing since #3896: the resolver reads `zh` for a
    // Chinese conversation and `en` for every other one, so a key missing from
    // either pack drops that language onto the resolver's fallback table.
    for (const k of OUTBOUND_KEYS) {
      expect(typeof lookup(GATE_LOCALES[lang], k)).toBe('string');
    }
  });

  it('every OTHER console.ai key IS localized — this guard is narrow on purpose', () => {
    // Guards against over-correcting: the fix for the outbound keys must not
    // become a reason to leave the surrounding labels untranslated.
    const aiLabels = Object.keys((en as any).console.ai).filter(
      (k) => typeof (en as any).console.ai[k] === 'string',
    );
    const outboundLeaf = new Set(OUTBOUND_KEYS.map((k) => k.split('.').pop()));
    const labels = aiLabels.filter((k) => !outboundLeaf.has(k));
    expect(labels.length).toBeGreaterThan(20);
    for (const k of labels) {
      expect((de as any).console.ai[k], `de is missing console.ai.${k}`).toBeTypeOf('string');
    }
  });
});
