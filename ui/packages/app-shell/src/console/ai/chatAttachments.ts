// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the AI chat sends for the files a user attaches to a turn
 * (objectstack#32749, ruling A, console half).
 *
 * - Spreadsheets are parsed in the page and briefed as text; that path stays
 *   in `AiChatPage` and this module only names which files take it.
 * - Images (PNG, JPEG, GIF, WebP) and PDFs up to {@link CHAT_ATTACHMENT_MAX_BYTES}
 *   are uploaded to storage as the signed-in user, through the console's
 *   ambient upload adapter, and completed without binding them to any record.
 *   Each upload becomes one AI SDK file part on the user turn: the stored
 *   file's address as `url` (never an inline data URL) and its `sys_file` id
 *   under `providerMetadata.objectstack.fileId`, where the agent reads it.
 * - Every other attached file — over the cap, of another type, or whose upload
 *   failed — is not sent, and the turn's text names it and says why, so the
 *   user and the model both know its content was not read.
 */
import type { ChatFilePart } from '@object-ui/plugin-chatbot';
import type { UploadResult } from '@object-ui/types';
import { joinAttachmentNames, resolveAttachmentNoteText, type AttachmentNoteKey } from './outboundAgentText.js';

/** The upload a turn's files go through: the console's `useUpload().upload`. */
export type ChatAttachmentUpload = (file: File) => Promise<UploadResult>;

/** Files parsed in the page and briefed as text, never uploaded. */
const SPREADSHEET_NAME = /\.(xlsx|xlsm|csv|tsv|txt)$/i;

/** The image media types the chat uploads: the ones vision models read. */
export const CHAT_IMAGE_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const CHAT_PDF_MEDIA_TYPE = 'application/pdf';

/** The size cap for an uploaded image or PDF: 10 MiB each. */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The media type a file is sent under when the browser named none. */
const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: CHAT_PDF_MEDIA_TYPE,
};

export function isSpreadsheetAttachment(file: File): boolean {
  return SPREADSHEET_NAME.test(file.name);
}

/** The media type the chat uploads `file` under, or `undefined` when it does not upload that type. */
export function uploadableMediaType(file: File): string | undefined {
  const declared = (file.type ?? '').toLowerCase();
  const mediaType = declared || MEDIA_TYPE_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  return CHAT_IMAGE_MEDIA_TYPES.includes(mediaType) || mediaType === CHAT_PDF_MEDIA_TYPE ? mediaType : undefined;
}

/** The outcome for a turn's non-spreadsheet files. */
export interface ChatAttachmentOutcome {
  /** One file part per uploaded file, in the order the files were attached. */
  parts: ChatFilePart[];
  /** The files that were uploaded and are sent as `parts`. */
  sent: File[];
  tooLarge: File[];
  unsupported: File[];
  failed: File[];
}

/**
 * Uploads the turn's images and PDFs and answers the parts to send. Never
 * throws: a failed upload is reported in `failed`, and the turn still sends.
 */
export async function uploadChatAttachments(
  files: readonly File[],
  upload: ChatAttachmentUpload,
  baseUrl: string,
): Promise<ChatAttachmentOutcome> {
  const outcome: ChatAttachmentOutcome = { parts: [], sent: [], tooLarge: [], unsupported: [], failed: [] };
  const queued: Array<{ file: File; mediaType: string }> = [];
  for (const file of files) {
    const mediaType = uploadableMediaType(file);
    if (!mediaType) outcome.unsupported.push(file);
    else if (file.size > CHAT_ATTACHMENT_MAX_BYTES) outcome.tooLarge.push(file);
    else queued.push({ file, mediaType });
  }
  const settled = await Promise.allSettled(queued.map(({ file }) => upload(file)));
  settled.forEach((result, i) => {
    const { file, mediaType } = queued[i];
    const stored = result.status === 'fulfilled' ? result.value : undefined;
    const fileId = stored?.meta?.fileId;
    // An adapter that stores nothing answers no file id (the no-provider
    // default mints a tab-local `blob:` URL): that is a failed upload.
    if (!stored || typeof fileId !== 'string' || fileId.length === 0) {
      if (stored?.url.startsWith('blob:')) URL.revokeObjectURL(stored.url);
      outcome.failed.push(file);
      return;
    }
    outcome.sent.push(file);
    outcome.parts.push({
      type: 'file',
      mediaType,
      filename: file.name,
      url: new URL(stored.url, baseUrl).href,
      providerMetadata: { objectstack: { fileId } },
    });
  });
  return outcome;
}

/**
 * The lines the turn's text carries about its non-spreadsheet files: which
 * were sent as files, and which were not and why. Empty when there were none.
 * In the conversation's language (objectstack#34461): Chinese for a Chinese
 * conversation, English for any other.
 */
export function chatAttachmentNotes(outcome: ChatAttachmentOutcome, conversationIsZh: boolean): string {
  const names = (files: readonly File[]) => joinAttachmentNames(conversationIsZh, files.map((f) => f.name));
  const note = (key: AttachmentNoteKey, files: readonly File[]) =>
    resolveAttachmentNoteText(conversationIsZh, key, { count: String(files.length), names: names(files) });
  const lines: string[] = [];
  if (outcome.sent.length > 0) lines.push(note('filesSent', outcome.sent));
  if (outcome.tooLarge.length > 0) lines.push(note('filesTooLarge', outcome.tooLarge));
  if (outcome.unsupported.length > 0) lines.push(note('filesUnsupported', outcome.unsupported));
  if (outcome.failed.length > 0) lines.push(note('filesUploadFailed', outcome.failed));
  return lines.map((line) => `\n\n${line}`).join('');
}
