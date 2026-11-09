// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 11] The file-reference hydration bodies of `ObjectQL`, moved
 * out of `engine.ts` whole: `resolveFileReferences` (a read's file-field ids
 * expanded to their `sys_file` read form), `callerMayReadSysFile` (#24335:
 * the admission asked before the caller's `sys_file` read),
 * `serveRefusedFileHydration` (the refused arm), `servableFileRows` (the one
 * servability rule both arms serve by) and `readParentDerivedFiles` (#22637:
 * the field-owned verdict a refused caller is still served by), with the
 * three module helpers they use: `isReadRefusal`, `toFileValue` and
 * `PARENT_DERIVED_FILE_COLUMNS`.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same stored-form opt-out, the same one batched
 * `sys_file` read, the same fail-open `catch` and its three answers, the same
 * tombstone rule and the same parent-derived read. Each method's docblock
 * stays on the method in `engine.ts`, which is still the contract. The three
 * helpers move with their docblocks, byte for byte. `isReadRefusal` alone is
 * exported, for the one other sub-read that serves a refusal in the value
 * (`engine-reference-name-visible.ts`, #29460), so the two read one predicate.
 *
 * Nothing stays behind in this section: every member of it moved.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-referential-integrity.ts` applies it. The class keeps all five
 * methods with name, modifiers, signature, docblock and position, and each
 * body is one literal of exactly the {@link FileReferenceHydrationHost}
 * members that method reads, plus a `.call`. The fields a body reads
 * (`_registry`, `logger`, `_heldFileResolver`,
 * `_fieldOwnedFileReadAuthorizer`) go as GETTERS, so each read happens when
 * the body makes it, as it did. The methods they call (`find`,
 * `callerMayReadSysFile`, `serveRefusedFileHydration`, `servableFileRows`,
 * `readParentDerivedFiles`, `resolveReadableIdsSecurity`) go as late-bound
 * closures over the instance, so a double or spy set on the engine is still
 * the one a call reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import { FILE_REFERENCE_TYPES, isFileIdToken, RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import type { FileRefusedValue } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  // [#22637] The caller's envelope, stripped of the operation-private `__`
  // keys, before file-field hydration forwards it to the download door's
  // field-owned verdict — see `readParentDerivedFiles`.
  withoutOperationPrivateKeys,
} from '@objectstack/core';
import { isMissingTableError } from '@objectstack/metadata/errors';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters.
 */
export interface FileReferenceHydrationHost {
  readonly _registry: ObjectQL['_registry'];
  readonly logger: ObjectQL['logger'];
  readonly _heldFileResolver: ObjectQL['_heldFileResolver'];
  readonly _fieldOwnedFileReadAuthorizer: ObjectQL['_fieldOwnedFileReadAuthorizer'];
  callerMayReadSysFile: ObjectQL['callerMayReadSysFile'];
  serveRefusedFileHydration: ObjectQL['serveRefusedFileHydration'];
  find: ObjectQL['find'];
  servableFileRows: ObjectQL['servableFileRows'];
  resolveReadableIdsSecurity: ObjectQL['resolveReadableIdsSecurity'];
  readParentDerivedFiles: ObjectQL['readParentDerivedFiles'];
}

/**
 * Is this failure the security layer refusing the CALLER's read — the
 * ADR-0112 `PERMISSION_DENIED` code — rather than the read failing?
 *
 * Asked by `resolveFileReferences`, whose `sys_file` sub-read runs as the
 * caller: a refusal there is a verdict about this reader, and is served in the
 * value (`FileRefusedValueSchema`), while every other failure is an outage that
 * fails open with a `warn`. Matched by the declared CODE alone — the closed
 * vocabulary every refusal class carries (`PermissionDeniedError` in
 * plugin-security, which this package cannot import) — ⛔ never by message
 * prose, and never by a driver's own ACL code (`42501` is the deployment's
 * database refusing the platform, not the platform refusing a reader).
 */
export function isReadRefusal(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === 'PERMISSION_DENIED';
}

/**
 * A servable `sys_file` row's expanded read form (`FileValueSchema`):
 * `{ id, name, size, mimeType, url }`, `url` derived from the stable
 * `/files/:fileId` resolver and never stored. ONE spelling for both arms of
 * `resolveFileReferences` — the caller's own `sys_file` read and the
 * parent-derived read a refused caller is served (#22637) — so the two can
 * never hand the same row out in two shapes.
 */
function toFileValue(row: any): Record<string, unknown> {
  return {
    id: String(row.id),
    ...(row.name != null ? { name: row.name } : {}),
    ...(row.size != null ? { size: row.size } : {}),
    ...(row.mime_type != null ? { mimeType: row.mime_type } : {}),
    url: `/api/v1/storage/files/${row.id}`,
  };
}

/**
 * [#22637] The `sys_file` columns the parent-derived read takes — the
 * ownership pair it matches on, the status the servability rule reads, and
 * the metadata `toFileValue` serves. Nothing else is read under the system
 * context that read runs in.
 */
const PARENT_DERIVED_FILE_COLUMNS = ['id', 'name', 'size', 'mime_type', 'status', 'ref_object', 'ref_id'];

/**
 * Resolve file-field id references to their expanded read form (ADR-0104 D3
 * wave 2). A `file`/`image`/`avatar`/`video`/`audio` value stored as an
 * opaque `sys_file` id string whose servable row this read finds (committed,
 * or a tombstone still held) is enriched, in place, to the `FileValueSchema`
 * object `{ id, name, size, mimeType, url }` — `url` derived from the stable
 * `/files/:fileId` resolver, never stored. That is one of three expanded
 * forms: an id nothing resolves stays the bare id (DUAL-MODE SAFE, and the
 * fail-open `catch` below), and an id whose `sys_file` read is refused to the
 * caller becomes `FileRefusedValueSchema` (REFUSED IS NOT ABSENT).
 *
 * DUAL-MODE SAFE: an inline-blob value (an object) and a string that does
 * NOT match a committed `sys_file` row (e.g. an external url) pass through
 * unchanged, so a field may hold either form during the pre-v17 window.
 *
 * REFUSED IS NOT ABSENT: when the caller's own `sys_file` read is refused,
 * each id becomes `{ id, metadataRefused: true }` (`FileRefusedValueSchema`)
 * rather than staying a bare id — see the `catch` below.
 *
 * PARENT-DERIVED (#22637, maintainer ruling B on #22624): that refusal is
 * about `sys_file` as an object, not about the files a record owns. A file
 * whose `ref_object` / `ref_id` name the record being read is judged by the
 * download door's own field-owned verdict (ADR-0104 D3) — the declared
 * `fileAccessDelegate` where the object names one, else the caller's read of
 * that record — and hydrates when it allows. Every other id keeps the
 * refused marker. See {@link readParentDerivedFiles}.
 *
 * ASKED BEFORE READ (#24335): the caller's `sys_file` read is issued only
 * when the security service admits it — {@link callerMayReadSysFile}, the
 * middleware's own object-level read gate. A caller it refuses goes
 * straight to the refused arm, the answer that read's refusal produced, so
 * the served value is the same and no access attempt is made: the security
 * layer logs no denial for a read the reader never asked for. A direct
 * `sys_file` read by that reader is refused, and logged, exactly as before.
 *
 * Batched: one admission ask and at most one `sys_file` `id $in […]` read
 * per call (no N+1) — and, on the refused arm only, one more system read
 * plus one verdict call; zero of each when no field holds a string value
 * (the blob-only case), so the step is free for objects that have not
 * adopted references.
 */
export async function resolveFileReferences(
  this: Pick<FileReferenceHydrationHost, '_registry' | 'callerMayReadSysFile' | 'serveRefusedFileHydration' | 'find' | 'logger' | 'servableFileRows'>,
  objectName: string,
  records: any[],
  execCtx?: ExecutionContext,
): Promise<any[]> {
  if (!records || records.length === 0) return records;
  // A caller whose subject is the STORED form — the ADR-0104 backfill /
  // reconciliation (#3617) — opts out of resolution entirely; expanding
  // ids before that scan would hide the very state it exists to audit.
  if ((execCtx as any)?.[RAW_FILE_VALUES_CONTEXT_KEY] === true) return records;
  const objectSchema = this._registry.getObject(objectName);
  if (!objectSchema || !objectSchema.fields) return records;
  // Nothing to resolve against if the file object is not even registered
  // (e.g. the storage plugin is absent) — skip without a failing query.
  if (!this._registry.getObject('sys_file')) return records;

  const fileFields = Object.entries(objectSchema.fields)
    .filter(([, def]: [string, any]) => def && FILE_REFERENCE_TYPES.has(def.type))
    .map(([name]) => name);
  if (fileFields.length === 0) return records;

  // Collect candidate ids. A file field legitimately holds either an inline
  // blob (an object — already the rich form, skipped) OR, in the dual-mode /
  // legacy world, a URL string (`https://…`, `/api/…`, `data:…`, `blob:…`).
  // Only an OPAQUE id token — the minted uuid/nanoid form, never url-shaped —
  // is a `sys_file` reference to resolve. Filtering out url-shaped strings is
  // what keeps a seeded `data:`/CDN image value from firing a bogus lookup.
  const candidateIds: string[] = [];
  const addCandidate = (v: unknown) => {
    if (isFileIdToken(v)) candidateIds.push(v);
  };
  for (const record of records) {
    for (const fieldName of fileFields) {
      const val = record[fieldName];
      if (val == null) continue;
      if (Array.isArray(val)) {
        for (const v of val) addCandidate(v);
      } else {
        addCandidate(val);
      }
    }
  }
  const uniqueIds = [...new Set(candidateIds)];
  if (uniqueIds.length === 0) return records; // blob-only / empty → zero cost

  // [#24335] Ask before reading: a caller the security service refuses
  // `sys_file` read is served the refused arm without the read whose
  // refusal would have produced it.
  if (!(await this.callerMayReadSysFile(execCtx))) {
    return this.serveRefusedFileHydration(objectName, records, fileFields, uniqueIds, execCtx);
  }

  // One batched sys_file read. `__expandRead` mirrors the lookup-expansion
  // sub-read (a system-built marker, never from client input). Metadata only —
  // byte-download authorization is enforced at the /files/:fileId resolver.
  let fileRows: any[] = [];
  try {
    fileRows = (await this.find(
      'sys_file',
      { where: { id: { $in: uniqueIds } }, context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext },
    )) ?? [];
  } catch (error) {
    // [#6116] Fail-open is deliberate and UNCHANGED — a file-metadata read
    // that fails must not take down the record read that asked for it, so the
    // ids pass through un-hydrated on EVERY branch below. What changes is
    // that the reasons stop being the same silence.
    //
    // Benign: `sys_file` is registered but its TABLE was never provisioned
    // (storage plugin present, schema sync not run yet). There are genuinely
    // no committed rows, so "leave the ids as-is" IS the truth and there is
    // nothing to report. Discriminated through the shared `isMissingTableError`
    // predicate (`@objectstack/metadata/errors`, #4825) — never a hand-rolled
    // `code === '42P01'` copy — the same call `seedAutonumber` makes above.
    //
    // Refused: the security layer refused THIS CALLER's read of `sys_file`
    // (ADR-0112 `PERMISSION_DENIED` — measured to arrive here as a throw,
    // never as a short result: the object-level CRUD gate refuses the whole
    // sub-read). The rows may well exist; this reader may not see them.
    // Leaving the bare id made the refusal read exactly like an id with no
    // committed row, or an outage — one value for three facts — so each id
    // is marked `{ id, metadataRefused: true }` instead
    // (`FileRefusedValueSchema`): the refusal reaches the reader as a
    // refusal, in the value itself.
    // Still fail-open — the record read that asked succeeds — and still no
    // `name`/`size`/`mimeType`/`url`, because none was read. The download
    // door judges bytes by the record that owns the file, on its own.
    //
    // `debug`, not `warn`: the failure is handed to the CALLER (AGENTS
    // "Degradation log levels", the third legal answer), and a `warn` here
    // fired once per read for every reader without `sys_file` read, with a
    // storage remedy that cannot fix a permission. ⛔ Only the declared
    // refusal code takes this arm: a database-level ACL fault (`42501`) is
    // the deployment's outage, not this caller's verdict, and stays below.
    //
    // [#22637] PARENT-DERIVED: the refusal answers "may this caller read
    // `sys_file`?", which is not the question ADR-0104 D3 asks of a file a
    // record OWNS. The download door already answers that one from the
    // owning record (maintainer ruling B on #22624: "a file field's metadata
    // follows the parent-derived verdict the download door already
    // applies"), so before marking anything the ids this result's own
    // records own are put to that verdict — `readParentDerivedFiles` — and
    // the ones it allows hydrate exactly as a `sys_file` reader would see
    // them. The marker stays on everything else: an id another record owns
    // (copied in), an attachment-only or unclaimed file, an id with no row,
    // and every id when the verdict is unwired or cannot be asked.
    //
    // [#24335] A caller the security service's admission already refused
    // never reaches this read (see {@link callerMayReadSysFile}); this arm
    // still serves a refusal the admission did not foresee, the same way.
    if (isReadRefusal(error)) {
      return this.serveRefusedFileHydration(objectName, records, fileFields, uniqueIds, execCtx);
    }
    // Everything else (connection drop, timeout, a database-level permission
    // fault, query error) means the rows may well exist and simply were not
    // seen. The consumer then receives a bare id where `{ id, name, size,
    // mimeType, url }` was due, and UI/export renders it as "this record has
    // no attachment": a fault wearing the appearance of legitimate absent
    // data, indistinguishable from a record that truly holds no file
    // (ADR-0110 D3). One `warn`, not `error`, per AGENTS "Degradation log
    // levels" — the loss is FUNCTIONAL and scoped to this response (the
    // answer is visibly smaller, and the next read repairs it); nothing on
    // this path claims to have persisted anything.
    if (!isMissingTableError(error, 'sys_file')) {
      this.logger.warn(
        'sys_file lookup failed; file fields keep their raw ids and will render as "no file" for this read — '
          + 'check storage/database availability, then re-read to hydrate',
        {
          object: objectName,
          fields: fileFields,
          unresolvedIds: uniqueIds.length,
          error: (error as Error)?.message,
        },
      );
    }
    return records; // fail-open: leave ids as-is
  }

  // Servability (committed, or a tombstone something still holds) is one
  // rule for both arms — see {@link servableFileRows}.
  const fileMap = await this.servableFileRows(objectName, fileRows);
  if (fileMap.size === 0) return records;

  for (const record of records) {
    for (const fieldName of fileFields) {
      const val = record[fieldName];
      if (val == null) continue;
      if (Array.isArray(val)) {
        record[fieldName] = val.map((v: any) =>
          typeof v === 'string' && fileMap.has(v) ? toFileValue(fileMap.get(v)) : v);
      } else if (typeof val === 'string' && fileMap.has(val)) {
        record[fieldName] = toFileValue(fileMap.get(val));
      }
    }
  }
  return records;
}

/**
 * [#24335] May this caller read `sys_file` at all? Asked of the registered
 * security service's `canReadObject` BEFORE {@link resolveFileReferences}
 * issues the caller's own `sys_file` read, as the parent-record read gate
 * asks before it reads a parent object ("A skipped object is not an access
 * attempt", plugin-audit). `canReadObject` is the security middleware's own
 * object-level read gate, arm for arm, and answers without logging or
 * throwing; the read it spares is one that gate would refuse, and
 * plugin-security logs every refusal at WARN — a line on every ordinary
 * record read by a reader without `sys_file` read, burying the real denials.
 *
 * Asked with the caller's envelope minus its operation-private `__` keys
 * (`withoutOperationPrivateKeys`, as {@link readParentDerivedFiles} asks its
 * verdict): no second derivation of authority, and no muting of the
 * middleware's log — the reader's own `sys_file` read still logs its denial.
 *
 * It only ever NARROWS what is read: `true` still reads as the caller, and
 * that read still decides. Unasked ⇒ `true`, the read goes to the middleware
 * as it did before: no usable security service, one whose contract omits the
 * optional `canReadObject`, or an ask that throws. Any other answer than
 * `true` ⇒ the refused arm, which is what that read's refusal served.
 */
export async function callerMayReadSysFile(
  this: Pick<FileReferenceHydrationHost, 'resolveReadableIdsSecurity'>,
  execCtx?: ExecutionContext,
): Promise<boolean> {
  const security = this.resolveReadableIdsSecurity();
  if (security.kind !== 'usable' || typeof security.svc.canReadObject !== 'function') return true;
  const caller = withoutOperationPrivateKeys((execCtx ?? {}) as Record<string, unknown>);
  try {
    return (await security.svc.canReadObject('sys_file', caller as ExecutionContext)) === true;
  } catch {
    return true;
  }
}

/**
 * The refused arm of {@link resolveFileReferences}: this caller may not read
 * `sys_file`, whether its admission said so up front (#24335) or its read was
 * refused. Each id a record of this result owns is put to the field-owned
 * verdict ({@link readParentDerivedFiles}, #22637) and hydrates when it
 * allows; every other id becomes `{ id, metadataRefused: true }`
 * (`FileRefusedValueSchema`). Logged at `debug`: the answer is handed to
 * the caller in the value.
 */
export async function serveRefusedFileHydration(
  this: Pick<FileReferenceHydrationHost, 'readParentDerivedFiles' | 'logger'>,
  objectName: string,
  records: any[],
  fileFields: string[],
  uniqueIds: string[],
  execCtx?: ExecutionContext,
): Promise<any[]> {
  const owned = await this.readParentDerivedFiles(objectName, records, uniqueIds, execCtx);
  this.logger.debug('sys_file read refused for this caller; file fields carry the refused marker', {
    object: objectName,
    fields: fileFields,
    refusedIds: uniqueIds.length,
    parentDerivedIds: owned.size,
  });
  const refused = (id: string): FileRefusedValue => ({ id, metadataRefused: true });
  // Judged per ELEMENT and per RECORD: the verdict covers a file only on
  // the record whose field owns it, so the same id copied into a second
  // record is still refused there. An owned, allowed id with no servable
  // row reads as the bare id — what a `sys_file` reader gets for it.
  const valueFor = (record: any, v: unknown): unknown => {
    if (!isFileIdToken(v)) return v;
    const hit = owned.get(v);
    if (!hit || record?.id == null || hit.ownerId !== String(record.id)) return refused(v);
    return hit.row ? toFileValue(hit.row) : v;
  };
  for (const record of records) {
    for (const fieldName of fileFields) {
      const val = record[fieldName];
      if (val == null) continue;
      if (Array.isArray(val)) {
        record[fieldName] = val.map((v: unknown) => valueFor(record, v));
      } else {
        record[fieldName] = valueFor(record, val);
      }
    }
  }
  return records;
}

/**
 * The servable subset of some `sys_file` rows, keyed by id — the rule both
 * arms of {@link resolveFileReferences} serve by, so a row hydrates under
 * the same condition whichever read found it.
 */
export async function servableFileRows(
  this: Pick<FileReferenceHydrationHost, '_heldFileResolver' | 'logger'>,
  objectName: string,
  rows: any[],
): Promise<Map<string, any>> {
  const fileMap = new Map<string, any>();
  // [commit c3c72a4bc] `committed` is servable and always was. A TOMBSTONE
  // (`status: 'deleted'` + `deleted_at`) is recoverable state, not a delete:
  // it is a claim about the future (this row is reapable once the grace
  // window ends) that the sweep re-checks and often withdraws. #10246 already
  // stopped the two download endpoints treating it as the last word — they
  // ask the reap guard's own `findFileHolder` and serve the row for as long
  // as something still holds it. This pass did not, so one `sys_file` row
  // answered 200 at `/files/:id` and a bare id here: two read surfaces, two
  // answers, and consumers render the bare id as "no attachment".
  //
  // ⛔ The predicate is NOT re-derived here. "Still held" has ONE definition
  // (`findFileHolder`, a deliberate union of `sys_attachment` join rows AND
  // the `ref_*` ownership columns) and it lives in the storage package, which
  // this one cannot import. A copy narrower by a limb would hide files the
  // sweep refuses to reap — the same defect one limb over — so the question
  // arrives through {@link registerHeldFileResolver} instead, the same
  // handover `resolveFileHolder` makes to the download routes. Unwired (bare
  // kernel, no storage plugin, tests): tombstones stay hidden, exactly as
  // before this existed.
  const tombstoned: any[] = [];
  for (const row of rows) {
    if (row?.id == null) continue;
    if (row.status === 'committed') fileMap.set(String(row.id), row);
    else if (row.status === 'deleted') tombstoned.push(row);
  }
  // Lazy by construction: a batch with no tombstone — every ordinary read —
  // costs nothing at all, and the resolver is BATCHED, so the residual case
  // costs one extra query for the whole read rather than one per row.
  if (tombstoned.length > 0 && this._heldFileResolver) {
    try {
      const held = await this._heldFileResolver(tombstoned);
      for (const row of tombstoned) {
        if (held?.has(String(row.id))) fileMap.set(String(row.id), row);
      }
    } catch (error) {
      // Unreadable evidence is not evidence of a holder. Keep the ids
      // un-hydrated — the answer this pass gave before commit c3c72a4bc, and the same
      // direction the download path fails in (`isServableForDownload`) and
      // the reap guard fails in (it vetoes rather than reaps when it cannot
      // tell). Distinct from the #6116 catch in `resolveFileReferences`,
      // which covers the `sys_file` read itself and is untouched.
      this.logger.warn(
        'sys_file holder check failed; tombstoned file fields keep their raw ids for this read',
        { object: objectName, tombstonedIds: tombstoned.length, error: (error as Error)?.message },
      );
    }
  }
  return fileMap;
}

/**
 * [#22637] The parent-derived half of a REFUSED `sys_file` hydration: which
 * of the ids this result holds are field-owned by a record in it, and does
 * the download door's verdict let this caller read them?
 *
 * Maintainer ruling B on #22624, verbatim as the card records it: "A file
 * field's metadata follows the parent-derived verdict the download door
 * already applies (ADR-0104 D3, `buildFileReadAuthorizer`): when the
 * caller's `sys_file` read is refused, `resolveFileReferences` still
 * hydrates a file whose `ref_object` / `ref_id` name the record being read
 * (the delegate consulted where the owner object declares a
 * `fileAccessDelegate`); a referenced id that does not point at that record
 * keeps PR #22620's refused marker; direct `sys_file` queries and
 * `public_read` are unchanged."
 *
 * Two reads, both narrow:
 *
 *  1. **Which ids does a record in this result own?** One `sys_file` read
 *     under a `sudo()`-shaped context (`{ ...caller, isSystem: true }`: the
 *     caller's tenant wall and transaction ride along). The `where` itself
 *     asks for the ownership pair — `ref_object` this object, `ref_id` one
 *     of these records — so a file that is not field-owned here is never
 *     read at all, and only {@link PARENT_DERIVED_FILE_COLUMNS} leave the
 *     driver. It is the same posture the download door reads a file in (by
 *     id, under the system context, never the caller's `sys_file` grant).
 *     `sys_file`'s own read rule is untouched: this read serves only the ids
 *     a record the caller just read holds, and the caller's own `sys_file`
 *     queries are refused exactly as before.
 *  2. **May this caller read those owners' files?** The registered
 *     {@link FieldOwnedFileReadAuthorizer} — the door's own field-owned arm,
 *     handed over by the storage plugin, never re-derived here — asked ONCE
 *     with every owner id, under the caller's envelope minus its
 *     operation-private `__` keys (`withoutOperationPrivateKeys`: the
 *     verdict judges the caller, not this sub-read). It consults the
 *     owner object's `fileAccessDelegate` where one is declared, so a
 *     delegate-governed object gets the delegate's answer and not the raw
 *     record read.
 *
 * Narrower than the door, by the ruling: the door also serves a file's
 * uploader and a file reachable through any `sys_attachment` parent; this
 * serves only a file owned by the record it is read in.
 *
 * Returns, per allowed file id, the owning record's id and its servable row
 * — `null` when the row is owned and allowed but not servable, which the
 * caller reads as the bare id a `sys_file` reader would see. An id absent
 * from the map keeps the refused marker. Unwired, no record ids, or a
 * failure: an empty map — every id stays refused, the answer before this
 * existed. [#26672] `find` / `findOne` read `id` for any projection that
 * names a file field ({@link withFileOwnerKey}), so a caller's projection
 * that leaves `id` out does not land here.
 */
export async function readParentDerivedFiles(
  this: Pick<FileReferenceHydrationHost, '_fieldOwnedFileReadAuthorizer' | 'find' | 'servableFileRows' | 'logger'>,
  objectName: string,
  records: any[],
  uniqueIds: string[],
  execCtx?: ExecutionContext,
): Promise<Map<string, { ownerId: string; row: any | null }>> {
  const owned = new Map<string, { ownerId: string; row: any | null }>();
  const authorize = this._fieldOwnedFileReadAuthorizer;
  if (!authorize) return owned;
  const recordIds = [
    ...new Set(records.map((r) => r?.id).filter((id) => id != null && id !== '').map(String)),
  ];
  if (recordIds.length === 0) return owned;

  const caller = withoutOperationPrivateKeys((execCtx ?? {}) as Record<string, unknown>);
  try {
    const rows: any[] = (await this.find('sys_file', {
      where: { id: { $in: uniqueIds }, ref_object: objectName, ref_id: { $in: recordIds } },
      fields: [...PARENT_DERIVED_FILE_COLUMNS],
      context: { ...caller, isSystem: true } as ExecutionContext,
    })) ?? [];
    // The ownership pair, read off the row this answer serves: the `where`
    // narrows the read; this is the condition the ruling serves by.
    const candidates = rows.filter((row) =>
      row?.id != null && row.ref_object === objectName && row.ref_id != null
      && recordIds.includes(String(row.ref_id)));
    if (candidates.length === 0) return owned;

    const ownerIds = [...new Set(candidates.map((row) => String(row.ref_id)))];
    const readable = await authorize(objectName, ownerIds, caller);
    const allowed = candidates.filter((row) => readable?.has(String(row.ref_id)));
    if (allowed.length === 0) return owned;

    const servable = await this.servableFileRows(objectName, allowed);
    for (const row of allowed) {
      owned.set(String(row.id), { ownerId: String(row.ref_id), row: servable.get(String(row.id)) ?? null });
    }
    return owned;
  } catch (error) {
    // The widening could not be judged, so it is not served: every id keeps
    // the refused marker, which is still true — this caller's `sys_file`
    // read WAS refused. The record read that asked still succeeds
    // (fail-open, #6116). `warn`, per AGENTS "Degradation log levels": the
    // loss is FUNCTIONAL and scoped to this response — a reader the door
    // would serve sees "details refused" — and nothing here claims to have
    // persisted anything.
    this.logger.warn(
      'sys_file parent-derived check failed; file fields keep the refused marker for this read — '
        + 'check storage/database availability, then re-read to hydrate',
      {
        object: objectName,
        refusedIds: uniqueIds.length,
        error: (error as Error)?.message,
      },
    );
    return new Map();
  }
}
