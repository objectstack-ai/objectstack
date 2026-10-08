// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { StandardErrorCode } from '@objectstack/spec/api';
import type { FileRecord } from './metadata-store.js';

/**
 * The upload ownership rule (#22046, ruling B) — declared ONCE, here.
 *
 * Three upload doors act on an id the caller names rather than one they were
 * just handed: the commit door (`POST …/upload/complete`), the
 * chunked-completion door (`POST …/upload/chunked/:uploadId/complete`) and the
 * progress door (`GET …/upload/chunked/:uploadId/progress`). Each authenticated
 * the session and then acted on whatever row the id resolved to. Each now asks
 * this predicate, right after its by-id read and before any write or any
 * disclosure, and refuses with {@link NOT_UPLOADER_STATUS} /
 * {@link NOT_UPLOADER_CODE} when it answers `false`.
 *
 * The rule, as ruled:
 *  - the caller's user id must EQUAL the file's `owner_id` — the uploader both
 *    upload-start doors already stamp from the session, and which no door read
 *    before this rule;
 *  - an upload session carries no user column: it reaches its uploader
 *    through `file_id`, so the chunked doors read the file row and ask this
 *    same question of it — there is no second rule for sessions;
 *  - an EMPTY `owner_id` is refused, and so is a file row that cannot be
 *    found: a door that meets either refuses rather than guessing an owner;
 *  - there is NO administrator exception — the rule reads "the uploader only".
 *    An exception, if a real need appears, is additive and decided on its own.
 *
 * What it does not decide: who may read a file's bytes (the download doors'
 * `authorizeDownload` stands), who may start an upload, and the organization
 * the doors stamp and scope by. It is a pure function of the two values it is
 * handed, so a new door that acts on a file or upload id inherits it by
 * calling it — never by re-deriving the comparison.
 *
 * ⛔ Every refusal is the same answer: one status, one code, one message, with
 * nothing in it about the row. A caller who is not the uploader learns nothing
 * from the refusal about whose file it is or which organization holds it.
 */
export function isFileUploader(
  callerUserId: string | undefined,
  file: Pick<FileRecord, 'owner_id'> | null | undefined,
): boolean {
  if (typeof callerUserId !== 'string' || callerUserId.length === 0) return false;
  const ownerId = file?.owner_id;
  if (typeof ownerId !== 'string' || ownerId.length === 0) return false;
  return ownerId === callerUserId;
}

/** The status a door answers when {@link isFileUploader} refuses. */
export const NOT_UPLOADER_STATUS = 403;

/** The code a door answers when {@link isFileUploader} refuses (ADR-0112 vocabulary). */
export const NOT_UPLOADER_CODE: StandardErrorCode = 'PERMISSION_DENIED';

/**
 * The message a door answers when {@link isFileUploader} refuses — constant on
 * purpose, so the refusal of a caller in the uploader's organization and of a
 * caller in another one are the same body.
 */
export const NOT_UPLOADER_MESSAGE = 'Only the user who started this upload can act on it';
