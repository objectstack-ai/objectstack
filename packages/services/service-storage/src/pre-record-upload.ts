// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32686] A file uploaded before its record exists, and the binding that
 * decides which write may take it.
 *
 * An agent cannot create a record whose file field is required: the record
 * needs the file, and an upload link used to need the record. So an upload
 * link can name an object and a file field with no record (ruling A): the
 * agent hands the link to its user, the user uploads, and the agent creates
 * the record naming the file id the link answered — the order the console's
 * own form uses (upload, then save). The `required` rule is not touched.
 *
 * Such a file is a committed `sys_file` row owned by the uploader, which no
 * record holds yet. What makes it different from any other unclaimed upload
 * is the binding its `metadata` carries, written when the bytes land
 * (`record-file-access.ts`): the user, the object, the file field, the
 * organization and the deadline for using it. The binding is read in two
 * places, both asking this module:
 *
 *  - **A record write naming the file** (`file-reference-lifecycle.ts`,
 *    before the driver runs): {@link preRecordReferenceRefusal}. While no
 *    record holds it, only a write by the bound user, on the bound object and
 *    field, before the deadline, may take it; another user, a system or
 *    context-less write, another object or field, or a write after the
 *    deadline is refused at the field. Once a record holds it, no user's
 *    write puts it in a second record until the deadline; after that it is
 *    that record's file like any other.
 *  - **The download doors** (`storage-service-plugin.ts`): while no record
 *    has held it, only its uploader may read it. The deadline does not change
 *    that.
 *
 * The binding governs only until a record has held the file. A record that
 * lets it go (its field cleared or replaced, or the record deleted) leaves
 * `released_ref_*` on the row (#26046), and from then on the binding is
 * ignored: the file is that record's released file, read by that record's
 * rule and taken again by whoever may read it, exactly as any other. The
 * binding itself is never rewritten, so it records what the upload was for.
 *
 * Before the upload, the id the link answered is the link's own `pending`
 * row. No write takes it but its uploader's own, which the incomplete-upload
 * check refuses until the upload completes.
 *
 * Every value is a string because `sys_file.metadata` is a JSON object of
 * strings. No secret is kept: the link's own secret is gone once it is used.
 */

import { UPLOAD_LINK_KIND } from './upload-link-wire.js';

/** The marker a bound file's `metadata` carries, so no other row reads as one. */
export const PRE_RECORD_UPLOAD_KIND = 'pre_record_upload';

/**
 * How long after the upload the file may be put in its field, in seconds: one
 * hour. Long enough for the agent to read the file and create the record in
 * the same conversation; short enough that an id left in a transcript is
 * soon worth nothing.
 */
export const PRE_RECORD_CLAIM_WINDOW_SECONDS = 60 * 60;

/** What a file uploaded before its record is bound to. */
export interface PreRecordUploadBinding {
  kind: typeof PRE_RECORD_UPLOAD_KIND;
  /** The object whose record may take the file. */
  object: string;
  /** The file field it may go into. */
  field: string;
  /** The user who uploaded it, and the only one whose write may use it. */
  user_id: string;
  /** The organization the link was issued in, when there was one. */
  organization_id?: string;
  /** Until when a write may put it in its field (ISO 8601). */
  claim_until: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** `sys_file.metadata` for a binding. */
export function preRecordBindingMetadata(binding: PreRecordUploadBinding): string {
  return JSON.stringify({
    kind: binding.kind,
    object: binding.object,
    field: binding.field,
    user_id: binding.user_id,
    ...(binding.organization_id !== undefined ? { organization_id: binding.organization_id } : {}),
    claim_until: binding.claim_until,
  });
}

/**
 * The binding a `sys_file` row carries, or `null` when it carries none (every
 * file not uploaded through a link that named no record). A row whose
 * metadata names the kind but not every value is answered as bound to nobody
 * — no user, object or deadline that any write can meet — so a damaged
 * binding refuses rather than reading as an ordinary file.
 */
export function preRecordBindingOf(row: Record<string, unknown> | null | undefined): PreRecordUploadBinding | null {
  const raw = row?.metadata;
  if (typeof raw !== 'string' || !raw.includes(PRE_RECORD_UPLOAD_KIND)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = parsed as Partial<PreRecordUploadBinding> | null;
  if (!s || typeof s !== 'object' || s.kind !== PRE_RECORD_UPLOAD_KIND) return null;
  return {
    kind: PRE_RECORD_UPLOAD_KIND,
    object: nonEmptyString(s.object) ? s.object : '',
    field: nonEmptyString(s.field) ? s.field : '',
    user_id: nonEmptyString(s.user_id) ? s.user_id : '',
    ...(nonEmptyString(s.organization_id) ? { organization_id: s.organization_id } : {}),
    claim_until: nonEmptyString(s.claim_until) ? s.claim_until : '',
  };
}

/** Whether no record's field holds the file now. */
function unheld(row: Record<string, unknown>): boolean {
  return row.ref_id == null || row.ref_id === '';
}

/**
 * Whether a record held the file and let it go (#26046: `releaseOwnership`
 * keeps the record, `claimFile` clears it when another record takes the
 * file). A released file is that record's file to judge, never the upload's.
 */
function released(row: Record<string, unknown>): boolean {
  return nonEmptyValue(row.released_ref_id) || nonEmptyValue(row.released_ref_object);
}

function nonEmptyValue(value: unknown): boolean {
  return value != null && value !== '';
}

/** Whether no record holds the file now and none has held it since the upload. */
function neverHeld(row: Record<string, unknown>): boolean {
  return unheld(row) && !released(row);
}

/**
 * Whether `row` is an open or spent upload link that names no record: the
 * `pending` row a link without a record reserves as its file (its id is the
 * file id the link answered), before the upload turns it into the file.
 */
function isPreRecordLinkRow(row: Record<string, unknown>): boolean {
  const raw = row.metadata;
  if (typeof raw !== 'string' || !raw.includes(UPLOAD_LINK_KIND)) return false;
  try {
    const s = JSON.parse(raw) as Record<string, unknown> | null;
    return !!s && s.kind === UPLOAD_LINK_KIND && s.target === 'field' && !nonEmptyString(s.record_id);
  } catch {
    return false;
  }
}

/**
 * Whether a file uploaded before its record, or the row its link reserved,
 * is read only by its uploader now: while no record has held it. The download
 * doors ask this after their uploader arm, so a `true` here means "deny
 * everyone else". Every other file, a released one included, is judged as
 * before.
 */
export function isUploaderOnlyFile(row: Record<string, unknown>): boolean {
  return neverHeld(row) && (preRecordBindingOf(row) !== null || isPreRecordLinkRow(row));
}

/** Why a write may not put a bound file in a field. */
export type PreRecordReferenceRefusal =
  /** The writer is not the uploader (or there is no writer): answered as a file they cannot open. */
  | { kind: 'not_yours' }
  /** The uploader's own write, into a slot the file was not uploaded for. */
  | { kind: 'other_slot'; object: string; field: string }
  /** The uploader's own write, with the file already in another record within its window. */
  | { kind: 'spent' }
  /** The uploader's own write, after the deadline, with no record holding it. */
  | { kind: 'expired' };

/**
 * May this write put `row` (a file it names) into `object`.`field`? `null`
 * admits it, or says nothing about it (a file with no binding, or one a
 * record has let go); otherwise the reason it is refused. `heldHere` is
 * whether this very slot already holds the file (an update rewriting its own
 * value), which takes nothing and is always admitted. `writerUserId` is the
 * user the write runs as; a system or context-less write has none.
 */
export function preRecordReferenceRefusal(
  row: Record<string, unknown>,
  target: { object: string; field: string; heldHere: boolean },
  writerUserId: string | null,
  now: number,
): PreRecordReferenceRefusal | null {
  if (target.heldHere) return null;
  const binding = preRecordBindingOf(row);
  if (!binding) {
    // The link's own `pending` row, before the upload: its uploader's write
    // is refused by the incomplete-upload check; every other writer, a
    // system or context-less write included, is refused here, so the
    // published id reserves nothing for anyone else.
    if (isPreRecordLinkRow(row) && neverHeld(row) && (writerUserId === null || String(row.owner_id ?? '') !== writerUserId)) {
      return { kind: 'not_yours' };
    }
    return null;
  }
  // A record held it and let it go: that record's released file (#26046).
  if (unheld(row) && released(row)) return null;
  const deadline = Date.parse(binding.claim_until);
  const open = Number.isFinite(deadline) && now < deadline;
  if (!unheld(row)) {
    // In a record already. After its window it is that record's file like
    // any other, which the read check and copy-on-claim judge; within it, no
    // user's write puts it into a second slot. A system write copies it as
    // it copies any file a record holds: it names no user whose upload this
    // could be, and the record that holds the file keeps it.
    if (!open || writerUserId === null) return null;
    return writerUserId === binding.user_id ? { kind: 'spent' } : { kind: 'not_yours' };
  }
  if (writerUserId === null || writerUserId !== binding.user_id) return { kind: 'not_yours' };
  if (target.object !== binding.object || target.field !== binding.field) {
    return { kind: 'other_slot', object: binding.object, field: binding.field };
  }
  if (!open) return { kind: 'expired' };
  return null;
}
