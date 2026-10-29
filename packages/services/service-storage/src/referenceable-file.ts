// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * "May this write reference that file?" — the ONE predicate every write that
 * names a `sys_file` id asks of its caller, wherever the id is written:
 *
 *  - a file-class FIELD on a record (`file-reference-lifecycle.ts`, ADR-0104
 *    D3 wave 2), before it claims or copies the file;
 *  - a `sys_attachment` row's `file_id` (`attachment-access-hooks.ts`), on
 *    insert and on an update that changes it — an attachment is how a file
 *    becomes readable through a parent record, so linking one is a way to
 *    hand its bytes to that parent's readers.
 *
 * Both doors ask it here, so a file a caller may not open cannot be referenced
 * through either of them, and the two cannot disagree about which files a
 * caller may take. The verdict itself is the download door's
 * ({@link FileReferenceReadAuthorizer}, bound by the storage plugin): one file,
 * one access rule.
 */

/**
 * [#25692] "May the caller of this write read this file?" — the download
 * door's verdict on the file's bytes, asked of the write's caller.
 *
 * Supplied by the storage plugin, which binds it to the door's own judgement
 * (`storage-service-plugin.ts`), and never decided by a write gate: one file,
 * one access rule, so the bytes, the metadata and a reference to them are
 * judged by one predicate. `true` admits; `false` refuses. A throw is not a
 * verdict — the plugin's binding lets only an authorization-store outage
 * through, and it propagates, so an unreadable store fails the write rather
 * than reading as either answer.
 */
export type FileReferenceReadAuthorizer = (
  file: Record<string, unknown>,
  context: ExecutionContext,
) => Promise<boolean>;

/** The slice of the data engine the lookup reads through. */
export interface ReferenceableFileEngine {
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

// Bookkeeping reads want the STORED form — never the read resolver's expanded
// shape.
const SYSTEM_READ_CTX = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as const;

/**
 * The bookkeeping context for LOOKING UP a file a write references, carrying
 * the acting organization when the triggering write had one.
 *
 * A write references a file only as its own organization can reach it: the
 * organization travels as `tenantId`, and the driver's tenant term (the
 * wall's verdict for the posture in force, ADR-0131 D8) decides which rows the
 * lookup can see. ⛔ No organization comparison is written here: whether
 * `sys_file` has a tenant column, what a row with no organization means and
 * whether the posture walls at all (`single` does not) are the platform's
 * answers. No organization ⇒ the key is absent and the lookup reads as a plain
 * system read.
 */
export function systemReadContext(organizationId?: string | null): Record<string, unknown> {
  return typeof organizationId === 'string' && organizationId.length > 0
    ? { ...SYSTEM_READ_CTX, tenantId: organizationId }
    : { ...SYSTEM_READ_CTX };
}

/**
 * The `sys_file` row an id names, as THIS write may reference it.
 *
 *  1. The row as the acting organization reaches it ({@link systemReadContext}).
 *  2. [#25692] Then, when the plugin bound a read verdict and the write has a
 *     caller, whether that caller may read it.
 *
 * [#26043] When a caller is asked about, a file it may not read and an id the
 * lookup cannot see are one answer, `'refused'`, so a write door cannot tell
 * "may not read" from "does not exist". With no caller to ask (a system write,
 * a context-less programmatic call) or no verdict bound, an id the lookup
 * cannot see is `null`.
 */
export async function findReferenceableFile(
  engine: ReferenceableFileEngine,
  fileId: string,
  organizationId: string | null,
  caller: ExecutionContext | null,
  authorizeRead: FileReferenceReadAuthorizer | undefined,
): Promise<Record<string, unknown> | 'refused' | null> {
  const row = await engine.findOne('sys_file', { where: { id: fileId }, context: systemReadContext(organizationId) });
  if (!caller || !authorizeRead) return row ?? null;
  if (!row) return 'refused';
  return (await authorizeRead(row, caller)) ? row : 'refused';
}

/**
 * [#26043] The sentence a write door answers a `'refused'` file with, for the
 * field (`label`) that named it. It names the field only: the same words for a
 * file the caller may not open and for an id that does not exist, and nothing
 * about the file or who holds it.
 */
export function unreadableFileMessage(label: string): string {
  return `${label} cannot reference this file: it is not a file you can open. `
    + 'Choose a file you can open, or upload it again.';
}
