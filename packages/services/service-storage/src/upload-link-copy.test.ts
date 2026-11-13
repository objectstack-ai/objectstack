// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32712] The upload-link page's sentences: one entry per language on the
 * platform locale table, read through the package's one locale reader, and
 * the refusal each code the link's doors can answer is shown as. The page and
 * its doors are pinned through the routes in
 * `record-file-access.integration.test.ts`; these pins hold the table itself.
 */

import { describe, expect, it } from 'vitest';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { copyLocaleOf } from './copy-locale.js';
import {
  UPLOAD_LINK_COPY,
  formatUploadLinkExpiry,
  uploadLinkCopy,
  uploadLinkRefusalText,
  type UploadLinkCopy,
} from './upload-link-copy.js';
import { UPLOAD_LINK_UNUSABLE_MESSAGE } from './upload-link-wire.js';

/** Every sentence an entry holds, its two functions called. */
function sentencesOf(copy: UploadLinkCopy): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(copy)) {
    if (key === 'wanted') {
      out['wanted(attachments)'] = copy.wanted('attachments');
      out['wanted(field)'] = copy.wanted('field');
    } else if (key === 'expires') {
      out.expires = copy.expires('UNTIL');
    } else if (key === 'refused') {
      out.refused = copy.refused('REASON');
    } else {
      out[key] = value as string;
    }
  }
  return out;
}

describe('#32712 — the upload-link page\'s sentences', () => {
  it('carries every language on the platform locale table, each with every sentence written', () => {
    const english = sentencesOf(UPLOAD_LINK_COPY.en);
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const key = copyLocaleOf(tag);
      expect(key, tag).toBeDefined();
      const sentences = sentencesOf(UPLOAD_LINK_COPY[key!]);
      expect(Object.keys(sentences).sort(), tag).toEqual(Object.keys(english).sort());
      for (const [name, text] of Object.entries(sentences)) expect(text.trim(), `${tag} ${name}`).not.toBe('');
      expect(sentences.expires, tag).toContain('UNTIL');
      expect(sentences.refused, tag).toContain('REASON');
    }
  });

  it('is translated: no language but English repeats an English sentence', () => {
    const english = new Set(Object.values(sentencesOf(UPLOAD_LINK_COPY.en)));
    for (const [key, copy] of Object.entries(UPLOAD_LINK_COPY)) {
      if (key === 'en') continue;
      for (const [name, text] of Object.entries(sentencesOf(copy))) {
        if (name === 'lang' || name === 'dir' || name === 'refused') continue;
        expect(english.has(text), `${key} ${name}`).toBe(false);
      }
    }
  });

  it('keeps English as it was: the one unusable-link sentence, and a refusal\'s own text unprefixed', () => {
    expect(UPLOAD_LINK_COPY.en.unusable).toBe(UPLOAD_LINK_UNUSABLE_MESSAGE);
    expect(UPLOAD_LINK_COPY.en.refused('The field rejects it.')).toBe('The field rejects it.');
  });

  it('reads a request\'s code as the platform does: aliases, regions, and English for anything unnamed', () => {
    expect(uploadLinkCopy('zh-CN').lang).toBe('zh-CN');
    expect(uploadLinkCopy('zh-Hans-CN').lang).toBe('zh-CN');
    expect(uploadLinkCopy('zh-TW').lang).toBe('zh-Hant');
    expect(uploadLinkCopy('fr-CA').lang).toBe('fr');
    expect(uploadLinkCopy('en-US').lang).toBe('en');
    expect(uploadLinkCopy('xx-YY').lang).toBe('en');
    expect(uploadLinkCopy(undefined).lang).toBe('en');
    expect(uploadLinkCopy('ar').dir).toBe('rtl');
  });

  it('answers each refusal code the link can meet with the page\'s own sentence; any 503 as "try later"', () => {
    const zh = UPLOAD_LINK_COPY['zh-CN'];
    const cases: Array<[string, number, string]> = [
      ['AUTH_REQUIRED', 401, zh.signInRequired],
      ['RESOURCE_NOT_FOUND', 404, zh.unusable],
      ['PAYLOAD_TOO_LARGE', 413, zh.tooLarge],
      ['ERR_FILE_CONSTRAINT', 400, zh.fileNotAccepted],
      ['PERMISSION_DENIED', 403, zh.notAllowed],
      ['FIELD_NOT_ACCESSIBLE', 403, zh.fieldReadOnly],
      ['RECORD_LOCKED', 409, zh.recordLocked],
      ['RECORD_NOT_FOUND', 404, zh.recordGone],
      ['SERVICE_UNAVAILABLE', 503, zh.unavailable],
      ['PERMISSION_STORE_UNAVAILABLE', 503, zh.unavailable],
    ];
    for (const [code, status, sentence] of cases) {
      expect(uploadLinkRefusalText(zh, status, code, 'producer text'), code).toBe(sentence);
    }
    // A code the page has no sentence for: the producer's text behind the lead-in.
    expect(uploadLinkRefusalText(zh, 400, 'VALIDATION_FAILED', 'Amount must be positive.'))
      .toBe('上传被拒绝：Amount must be positive.');
  });

  it('writes the expiry in the page\'s language, in UTC and saying so', () => {
    const at = '2026-11-12T21:54:00.000Z';
    expect(formatUploadLinkExpiry(UPLOAD_LINK_COPY['zh-CN'], at)).toBe('2026年11月12日 UTC 21:54');
    expect(formatUploadLinkExpiry(UPLOAD_LINK_COPY.en, at)).toMatch(/^November 12, 2026.*09:54\sPM UTC$/);
    expect(formatUploadLinkExpiry(UPLOAD_LINK_COPY.en, 'not a date')).toBe('not a date');
  });
});
