// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The text the console adds to what a user turn SENDS to the agent, resolved
// by the language of the CONVERSATION, never the console UI locale
// (objectui#3896): Chinese conversation -> Chinese, any other -> English.

/**
 * Fill `{{name}}` placeholders, in i18next's default interpolation syntax;
 * unknown placeholders are left intact so a
 * mis-named variable shows up in the sent text instead of silently vanishing.
 */
function interpolate(template: string, vars?: Readonly<Record<string, string>>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

// objectstack#34461 — the notes the console adds to a user turn about its
// attachments: the spreadsheet brief and the sent / not-read lines for other
// files. No pack defines them (a pack key is published surface, and no reader
// of a pack needs these), so their one source is this table.

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
