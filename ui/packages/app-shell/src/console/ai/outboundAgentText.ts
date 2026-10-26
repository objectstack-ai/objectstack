// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The text a plan / confirm card SENDS to the agent, resolved by the language of
// the CONVERSATION (objectui#3896).
//
// #772 / #2884 established the rule and `AiChatPage` states it at the gate:
// outbound text follows the conversation, rendered labels follow the console UI
// locale. The gate that reads this text lives in cloud
// (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`) and recognises exactly
// two languages — Chinese and English.
//
// The rule was only half implemented. Each site was
// `convZh ? '<Chinese literal>' : t('console.ai.…')`, and `t()` reads the UI
// PACK — so the non-Chinese branch answered with the UI locale, not with
// English. A zh console holding an English conversation therefore sent
// `确认，开始搭建。` into an English thread (the zh pack defines all four keys):
// the gate matched, the build ran, and the agent switched the whole thread to
// Chinese — #2884's symptom with the trigger reversed. `planAnswerMessage` was
// worse: never gated at all, so it sent the UI locale's value in both
// directions.
//
// Hence this module: ONE resolver, four sites, both directions, and the UI pack
// is never consulted. Chinese conversation -> the `zh` pack's value; anything
// else -> the `en` pack's value. Reading the built-in packs directly (instead of
// `t(key, { lng })`) is deliberate: an i18next lookup's answer depends on which
// bundles the host app happened to load and on `fallbackLng`, and a zh lookup
// that falls back to `en` is precisely the wrong-language bug above. Here the
// source of each string is declared, not resolved at runtime.

import { getLoadedBuiltInLocales } from '@object-ui/i18n';

/**
 * The `console.ai.*` keys that are outbound message TEXT rather than labels.
 * Mirrors `OUTBOUND_KEYS` in `packages/i18n/src/__tests__/outbound-agent-messages.test.ts`,
 * which owns the invariant that only the `en` and `zh` packs define them.
 */
export type OutboundAgentTextKey =
  | 'planApproveMessage'
  | 'planApproveDefaultsMessage'
  | 'planAnswerMessage'
  | 'changesConfirmMessage';

/**
 * Last-resort wording per gate language, used only if a pack stops defining the
 * key. Same convention as every `t(key, { defaultValue })` call site in this
 * repo — the English default is inline there too — except that a Chinese
 * conversation falls back to CHINESE. Falling back to English would re-create
 * the defect this module exists to fix, silently.
 *
 * `outboundAgentText.test.ts` pins each entry byte-identical to its pack value,
 * so the mirror cannot drift.
 */
const GATE_TEXT: Record<OutboundAgentTextKey, Record<'zh' | 'en', string>> = {
  planApproveMessage: {
    zh: '确认，开始搭建。',
    en: 'Looks good — build it as proposed.',
  },
  planApproveDefaultsMessage: {
    zh: '确认搭建，未决问题按你的合理假设和默认处理。',
    en: 'Build it with your best assumptions; use sensible defaults for the open questions.',
  },
  planAnswerMessage: {
    zh: '关于「{{question}}」，我选择「{{option}}」。',
    en: 'For "{{question}}", go with: {{option}}.',
  },
  changesConfirmMessage: {
    zh: '确认修改，应用你刚才提议的改动。',
    en: 'Confirm — apply the change you just proposed.',
  },
};

/** Read `console.ai.<key>` out of a locale pack, or `undefined` if absent. */
function packText(pack: unknown, key: OutboundAgentTextKey): string | undefined {
  const ai = (pack as { console?: { ai?: Record<string, unknown> } } | undefined)?.console?.ai;
  const value = ai?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Fill `{{name}}` placeholders. i18next's default interpolation syntax, applied
 * to a pack value we read ourselves; unknown placeholders are left intact so a
 * mis-named variable shows up in the sent text instead of silently vanishing.
 */
function interpolate(template: string, vars?: Readonly<Record<string, string>>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

/**
 * Resolve one outbound message in the CONVERSATION's language.
 *
 * @param conversationIsZh `isConversationZh(...)` for the thread being sent into.
 * @param key which outbound message.
 * @param vars values for the message's `{{placeholders}}`.
 */
export function resolveOutboundAgentText(
  conversationIsZh: boolean,
  key: OutboundAgentTextKey,
  vars?: Readonly<Record<string, string>>,
): string {
  const lang = conversationIsZh ? 'zh' : 'en';
  // The RESIDENT catalogue for that language, not a static import of it
  // (objectui#7479): `en` is always resident, and `zh` is resident on exactly
  // the boots where the console is running in Chinese. When it is not — an
  // English console answering a Chinese thread — this falls through to
  // {@link GATE_TEXT}, which `outboundAgentText.test.ts` pins BYTE-IDENTICAL to
  // the `zh` pack's four values, so the text that leaves is the same either
  // way. ⛔ Do not import the `zh` pack back to close that branch: it would put
  // a second 156 KB catalogue into every page load to re-derive four strings
  // that are already pinned equal.
  const template =
    packText(getLoadedBuiltInLocales()[lang], key) ?? GATE_TEXT[key][lang];
  return interpolate(template, vars);
}

/** Exposed for the pin that keeps {@link GATE_TEXT} and the packs identical. */
export const OUTBOUND_GATE_TEXT = GATE_TEXT;
