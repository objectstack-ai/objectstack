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
// Hence this module: ONE resolver, every outbound site, both directions, and the UI pack
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
  | 'planExtendExistingMessage'
  | 'planBuildNewAppMessage'
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
  // objectstack#27480 — the two answers of the extend-or-new question an
  // `iterate_or_new` plan asks. Like `planAnswerMessage` they answer a question
  // rather than approve a plan.
  planExtendExistingMessage: {
    zh: '在「{{app}}」上继续完善，不另建应用。',
    en: 'Keep improving "{{app}}" instead of building a new app.',
  },
  planBuildNewAppMessage: {
    zh: '另建一个独立应用。',
    en: 'Build a separate, new app.',
  },
  changesConfirmMessage: {
    zh: '确认修改，应用你刚才提议的改动。',
    en: 'Confirm — apply the change you just proposed.',
  },
};

/**
 * The pack each gate language reads, by the table tag `getLoadedBuiltInLocales()`
 * is keyed by (`@objectstack/spec/system` `PLATFORM_LOCALES`): a Chinese
 * conversation's gate text is the Simplified pack's.
 */
const PACK_TAG: Readonly<Record<'zh' | 'en', string>> = { zh: 'zh-Hans', en: 'en' };

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
  // (objectui#7479): `en` is always resident, and the Simplified Chinese pack
  // (`zh-Hans`, the table tag the snapshot is keyed by) is resident on exactly
  // the boots where the console is running in it. When it is not — an
  // English console answering a Chinese thread — this falls through to
  // {@link GATE_TEXT}, which `outboundAgentText.test.ts` pins BYTE-IDENTICAL to
  // the `zh-Hans` pack's outbound values, so the text that leaves is the same
  // either way. ⛔ Do not import the pack back to close that branch: it would
  // put a second 156 KB catalogue into every page load to re-derive strings
  // that are already pinned equal.
  const template =
    packText(getLoadedBuiltInLocales()[PACK_TAG[lang]], key) ?? GATE_TEXT[key][lang];
  return interpolate(template, vars);
}

/** Exposed for the pin that keeps {@link GATE_TEXT} and the packs identical. */
export const OUTBOUND_GATE_TEXT = GATE_TEXT;

// objectstack#34461 — the notes the console adds to a user turn about its
// attachments: the spreadsheet brief and the sent / not-read lines for other
// files. They are outbound text like the messages above, so they follow the
// CONVERSATION's language the same way: Chinese conversation -> Chinese, any
// other -> English. They are not gate text and no pack defines them (a pack
// key is published surface, and no reader of a pack needs these), so their
// one source is this table.

/** The attachment notes a user turn can carry. */
export type AttachmentNoteKey =
  | 'sheetBrief'
  | 'sheetHeaders'
  | 'sheetSample'
  | 'sheetParseFailed'
  | 'sheetsNotRead'
  | 'filesSent'
  | 'filesTooLarge'
  | 'filesUnsupported'
  | 'filesUploadFailed';

const ATTACHMENT_NOTE_TEXT: Record<AttachmentNoteKey, Record<'zh' | 'en', string>> = {
  sheetBrief: {
    zh: '[附件表格 {{name}} — {{rows}} 数据行 × {{columns}} 列(控制台已在本地解析,文件本体未上传)]',
    en: '[Attached spreadsheet {{name}} — {{rows}} data rows × {{columns}} columns (parsed in the console; the file itself was not uploaded)]',
  },
  sheetHeaders: {
    zh: '表头: {{cells}}',
    en: 'Headers: {{cells}}',
  },
  sheetSample: {
    zh: '样例{{n}}: {{cells}}',
    en: 'Sample {{n}}: {{cells}}',
  },
  sheetParseFailed: {
    zh: '[附件表格 {{name}}] 解析失败({{reason}})— 请引导用户改用对象列表的 Import 上传该文件。',
    en: "[Attached spreadsheet {{name}}] could not be parsed ({{reason}}) — guide the user to upload it with the object list's Import instead.",
  },
  sheetsNotRead: {
    zh: '(另有 {{count}} 个表格附件未读取 — 一次最多读取 2 个。)',
    en: '(Spreadsheet attachments not read: {{count}} more — at most 2 are read per message.)',
  },
  filesSent: {
    zh: '(用户附上了 {{count}} 个文件:{{names}} — 已作为文件随本条消息发送。)',
    en: '(Files the user attached ({{count}}): {{names}} — sent as files with this message.)',
  },
  filesTooLarge: {
    zh: '(以下附件超过 10 MB 上限,未上传,内容未读取:{{names}}。)',
    en: '(These attachments are over the 10 MB cap, were not uploaded, and their content was not read: {{names}}.)',
  },
  filesUnsupported: {
    zh: '(以下附件的类型暂不支持读取,未上传,内容未读取:{{names}} — 当前支持表格(Excel/CSV)、图片(PNG/JPEG/GIF/WebP)与 PDF。)',
    en: '(These attachments are of a type that cannot be read yet, were not uploaded, and their content was not read: {{names}} — spreadsheets (Excel/CSV), images (PNG/JPEG/GIF/WebP) and PDFs are supported.)',
  },
  filesUploadFailed: {
    zh: '(以下附件上传失败,内容未读取:{{names}}。)',
    en: '(These attachments failed to upload, and their content was not read: {{names}}.)',
  },
};

/** How a list of file names is joined in each language. */
const NAME_SEPARATOR: Readonly<Record<'zh' | 'en', string>> = { zh: '、', en: ', ' };

/**
 * Resolve one attachment note in the CONVERSATION's language.
 *
 * @param conversationIsZh whether the turn is being held in Chinese.
 * @param key which note.
 * @param vars values for the note's `{{placeholders}}`.
 */
export function resolveAttachmentNoteText(
  conversationIsZh: boolean,
  key: AttachmentNoteKey,
  vars?: Readonly<Record<string, string>>,
): string {
  return interpolate(ATTACHMENT_NOTE_TEXT[key][conversationIsZh ? 'zh' : 'en'], vars);
}

/** File names as one list, joined the way the conversation's language joins them. */
export function joinAttachmentNames(conversationIsZh: boolean, names: readonly string[]): string {
  return names.join(NAME_SEPARATOR[conversationIsZh ? 'zh' : 'en']);
}
