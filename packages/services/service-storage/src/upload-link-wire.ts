// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#30892] The upload link's wire facts, shared by the service that mints and
 * spends links (`record-file-access.ts`) and the doors and page that serve
 * them (`storage-routes.ts`, `upload-link-page.ts`) — in a module of their
 * own so the doors import no service code.
 */

/** The marker a link row's `metadata` carries, so no other pending row reads as a link. */
export const UPLOAD_LINK_KIND = 'upload_link';

/** The path segment the upload-link doors are mounted under, below the storage base path. */
export const UPLOAD_LINK_SEGMENT = 'upload-links';

/**
 * The one answer a link that cannot be used gets — used, expired, unknown, or
 * minted for another user than the signed-in caller, alike, so the answer says
 * nothing about which.
 */
export const UPLOAD_LINK_UNUSABLE_STATUS = 404;
export const UPLOAD_LINK_UNUSABLE_CODE: StandardErrorCode = 'RESOURCE_NOT_FOUND';
export const UPLOAD_LINK_UNUSABLE_MESSAGE =
  'This upload link cannot be used: it was used already, it has expired, it was made for someone else, or it does not exist. Ask for a new link.';

/**
 * [#32747] The most files one upload link takes in its one submit (ruling A:
 * one link, several files, capped). Only a link for a file field declared
 * `multiple: true` takes more than one; a single-file field link and an
 * attachments link take one. File fields declare no item cap of their own, so
 * this is the platform's. A submit carrying more is refused before the link is
 * spent: 400 `VALIDATION_ERROR` ({@link UPLOAD_LINK_FILE_COUNT_CODE}).
 */
export const UPLOAD_LINK_MAX_FILES = 10;

/** [#32747] The refusal of a submit carrying a number of files the link does not take. */
export const UPLOAD_LINK_FILE_COUNT_STATUS = 400;
export const UPLOAD_LINK_FILE_COUNT_CODE: StandardErrorCode = 'VALIDATION_ERROR';

/**
 * [#32747] That refusal's words, for a link that takes from `range.min` to
 * `range.max` files and a submit carrying `sent`. One spelling for the door
 * that reads the form and the service that spends the link.
 */
export function uploadLinkFileCountMessage(range: { min: number; max: number }, sent: number): string {
  const taken =
    range.max === 1
      ? 'takes one file'
      : range.min === range.max
        ? `takes exactly ${range.min} files, sent together`
        : `takes up to ${range.max} files, sent together`;
  return `Nothing was stored: this upload link ${taken}, and ${sent} ${sent === 1 ? 'was' : 'were'} sent.`;
}

/**
 * [#32747] The refusal of a several-file form sent to a link that takes one
 * file (a single-file field's, or an attachments link): that link takes its
 * file as the request body. Same code and status as a wrong count.
 */
export const UPLOAD_LINK_ONE_FILE_FORM_MESSAGE =
  'Nothing was stored: this upload link takes one file, sent as the request body, not as a several-file form.';

/**
 * [#32747] The multipart form a several-file submit is sent as: one part per
 * file named `file0` … `fileN-1`, in the order picked, and a `count` field
 * naming N. Indexed names, because a form parser that keeps one value per
 * name (Hono's `parseBody`, both transports) keeps only the last of a
 * repeated one; `count` lets the door refuse a body that lost a part rather
 * than store fewer files than were sent. Each part's file name is
 * URI-encoded, as the single-file submit's `x-file-name` header is.
 */
export const UPLOAD_LINK_FORM_COUNT_FIELD = 'count';
export const UPLOAD_LINK_FORM_FILE_PREFIX = 'file';
