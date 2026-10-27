// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { FieldFileDescription, IFieldFileService } from '@objectstack/spec/contracts';
import type { Seed, SeedFileContent, SeedFileReference } from '@objectstack/spec/data';
import { FILE_REFERENCE_TYPES, isFileIdToken, isSeedFileReference } from '@objectstack/spec/data';
// The platform's one answer to "did this read fail because the table has not
// been provisioned yet?" — a fresh install whose `sys_file` table the first
// upload provisions holds no file, so none is found.
import { isMissingTableError } from '@objectstack/metadata/errors';

/**
 * [#25779] The seed loader's half of a seed file — `seedFile(path)` written
 * into a file-class field (`@objectstack/spec/data`, `seed-file.zod.ts`).
 *
 * A file field holds an opaque `sys_file` id, and a seed record names the file
 * by the path the package ships it at instead. `os build` bundled the bytes
 * into the dataset's `files` map; this module turns each reference into a
 * file the written record owns:
 *
 *  1. **Before the write** ({@link SeedDatasetFiles.prepareRow}): every
 *     reference is checked against the bytes the dataset carries (present,
 *     the declared size, the declared SHA-256). A row the existing data already
 *     holds keeps the file it holds when that file was stored from the same
 *     path with the same bytes, name and type — a boot does not mint a new file
 *     for an unchanged fixture. Otherwise the bytes are stored through the
 *     `field-files` service as a `pending` file, and the reference is replaced
 *     by the file's id.
 *  2. **After the write** ({@link SeedDatasetFiles.settleRow}): the row's slot
 *     — (object, record, field) — is made the owner of the files, which commits
 *     them. A row that never lands leaves its files `pending`, for the
 *     pending-upload retention to reclaim.
 *
 * And one refusal for a value that is not a reference (shape 3): an id-shaped
 * string in a file field that names no file in the row's organization is
 * refused, by row, before anything is written. It used to be written as given,
 * where the read path shows no file and the reference hooks own nothing.
 *
 * Every refusal is the row's: it names the field, the value and the fix, and
 * the loader drops the row with it, counted and logged like any other row it
 * cannot write.
 */

/** One file-class field of the seeded object. */
interface FileField {
  readonly multiple: boolean;
}

/** The files a written row must own, per field. */
export type SeedFileClaims = ReadonlyArray<{ field: string; fileIds: string[] }>;

/** What {@link SeedDatasetFiles.prepareRow} decided for one row. */
export type SeedFileRowOutcome =
  | { ok: true; claims: SeedFileClaims }
  | { ok: false; field: string; attemptedValue: unknown; message: string };

/** The provenance a seed file's `sys_file` row keeps (`StoreFieldFileInput.metadata`). */
const PROVENANCE_PATH = 'seedFile';
const PROVENANCE_SHA256 = 'sha256';

/** How many file ids one `describeFiles` read names. */
const DESCRIBE_CHUNK = 500;

/**
 * [#26670] Hand the event loop one macrotask turn.
 *
 * A seed file costs its row about two dozen sequential engine calls: the
 * `sys_file` row written `pending`, the bytes, then the claim (the files read
 * again, the slot's held files read and released, the row committed), each
 * with the write hooks they run. On a synchronous driver (better-sqlite3,
 * the wasm fallback) every one of those `await`s resolves as a microtask, so
 * a run of rows never reaches the event loop's I/O phase at all: the claims
 * the loader settles after each 200-row insert batch ran as one unbroken
 * microtask chain, measured at 3–5 s per batch on a boot seeding 1,500 files,
 * and every request that arrived meanwhile — a sign-in — waited unread for
 * the whole chain. The connection pool was never the bottleneck (no hold
 * over 44 ms); the event loop was.
 *
 * So each row's file work ends here, and a request waits behind one row's
 * files, never behind a dataset's. The same cure as the import runner's
 * row loop (`@objectstack/core`, `import-runner.ts`), for the same cause.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/** The file-class fields of an object definition, by name. */
function fileFieldsOf(definition: unknown): Map<string, FileField> {
  const found = new Map<string, FileField>();
  const fields = (definition as { fields?: Record<string, { type?: unknown; multiple?: unknown } | undefined> } | null)
    ?.fields;
  if (!fields || typeof fields !== 'object') return found;
  for (const [name, field] of Object.entries(fields)) {
    if (typeof field?.type === 'string' && FILE_REFERENCE_TYPES.has(field.type)) {
      found.set(name, { multiple: field.multiple === true });
    }
  }
  return found;
}

/** The values a field holds, one per element (a `multiple` field holds an array). */
function elementsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** A stored `multiple` value may come back as JSON text; the ids it holds either way. */
function heldIdsOf(value: unknown): string[] {
  let parsed = value;
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
  }
  return elementsOf(parsed).filter(isFileIdToken);
}

/** The last segment of a seed file path: the file name a download is saved as by default. */
function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The bytes of one bundled seed file, checked against what `os build` recorded. */
type CheckedContent = { ok: true; bytes: Buffer; content: SeedFileContent } | { ok: false; reason: string };

/**
 * The files of one dataset: built once per dataset by {@link open}, asked once
 * per row by the loader.
 */
export class SeedDatasetFiles {
  private readonly checked = new Map<string, CheckedContent>();
  /** `describeFiles` answers, by organization (`''` for none), then by id. */
  private readonly described = new Map<string, Map<string, FieldFileDescription | null>>();

  private constructor(
    private readonly objectName: string,
    private readonly fields: ReadonlyMap<string, FileField>,
    private readonly files: Readonly<Record<string, SeedFileContent>>,
    private readonly service: IFieldFileService | null,
  ) {}

  /**
   * The dataset's file handling, or `null` when the seeded object declares no
   * file-class field — nothing below runs for such an object.
   *
   * `prefetch` names the ids the load will ask about up front (the ids the
   * matched rows hold and the id-shaped values the records author), so a
   * dataset is described in a few reads rather than one per row.
   */
  static async open(args: {
    dataset: Seed;
    objectDefinition: unknown;
    service: IFieldFileService | null;
    existingRecords: ReadonlyMap<string, Record<string, unknown>> | undefined;
    organizationId: string | null;
    dryRun: boolean;
  }): Promise<SeedDatasetFiles | null> {
    const fields = fileFieldsOf(args.objectDefinition);
    if (fields.size === 0) return null;
    const handler = new SeedDatasetFiles(
      args.dataset.object,
      fields,
      (args.dataset as { files?: Record<string, SeedFileContent> }).files ?? {},
      args.service,
    );
    if (!args.dryRun && args.service) {
      const ids = new Set<string>();
      for (const record of args.dataset.records as Array<Record<string, unknown>>) {
        for (const field of fields.keys()) {
          for (const element of elementsOf(record[field])) {
            if (isFileIdToken(element)) ids.add(element);
          }
        }
      }
      for (const row of args.existingRecords?.values() ?? []) {
        for (const field of fields.keys()) for (const id of heldIdsOf(row[field])) ids.add(id);
      }
      await handler.describe([...ids], args.organizationId);
    }
    return handler;
  }

  /**
   * Turn the row's seed file references into file ids, and refuse the row
   * when one of its file values cannot be honoured. `record` is changed in
   * place: each reference becomes the id of the file the row will hold.
   *
   * `existing` is the row the load matched, read with its STORED file values;
   * `willWrite` is whether the row is written at all (an `ignore`-mode match,
   * or an `update`-mode miss, writes nothing, so nothing is stored for it). A
   * dry run checks the references against the bundled bytes and touches
   * nothing else.
   */
  async prepareRow(args: {
    record: Record<string, unknown>;
    existing: Record<string, unknown> | undefined;
    organizationId: string | null;
    willWrite: boolean;
    dryRun: boolean;
  }): Promise<SeedFileRowOutcome> {
    // Every field is judged before any file is stored, so a refused row stores
    // nothing.
    const planned: Array<{
      field: string;
      def: FileField;
      contents: Array<{ reference: SeedFileReference; bytes: Buffer; content: SeedFileContent }>;
    }> = [];
    for (const [field, def] of this.fields) {
      const value = args.record[field];
      if (value === undefined || value === null) continue;
      const elements = elementsOf(value);
      const references = elements.filter(isSeedFileReference);

      if (references.length === 0) {
        // Shape 3: an id-shaped value must name a file the row's organization
        // holds. Anything else (an external URL, an inline blob) is kept as
        // written, as the reference hooks keep it.
        if (args.dryRun || !this.service) continue;
        const tokens = elements.filter(isFileIdToken);
        if (tokens.length === 0) continue;
        const known = await this.describe(tokens, args.organizationId);
        const missing = tokens.filter((id) => !known.get(id));
        if (missing.length > 0) {
          return this.refusal(
            field,
            value,
            `${this.objectName}.${field} holds ${missing.map((id) => `'${id}'`).join(', ')}, which names no stored ` +
              `file${args.organizationId ? ` in organization ${args.organizationId}` : ''}. A file field holds the id ` +
              'of a stored file; a seed names the file a package ships with seedFile(path) instead ' +
              "(e.g. seedFile('fixtures/contract.pdf')), and the loader stores it.",
          );
        }
        continue;
      }

      // A field holding seed files holds nothing else: the loader settles the
      // field's ownership to exactly the files it stored.
      if (references.length !== elements.length) {
        return this.refusal(
          field,
          value,
          `${this.objectName}.${field} mixes seedFile(...) values with other values. A field that takes seed files ` +
            'holds only seed files; write every file it holds as seedFile(path).',
        );
      }
      if (references.length > 1 && !def.multiple) {
        return this.refusal(
          field,
          value,
          `${this.objectName}.${field} holds one file, and the record gives it ${references.length} seedFile(...) ` +
            'values. Give it one, or declare the field `multiple: true`.',
        );
      }

      const contents: Array<{ reference: SeedFileReference; bytes: Buffer; content: SeedFileContent }> = [];
      for (const reference of references) {
        const checked = this.check(reference.$file);
        if (!checked.ok) return this.refusal(field, reference, checked.reason);
        contents.push({ reference, bytes: checked.bytes, content: checked.content });
      }
      if (args.dryRun || !args.willWrite) continue;
      if (!this.service) {
        return this.refusal(
          field,
          value,
          `${this.objectName}.${field} names seedFile('${references[0].$file}'), and this load has no file service to ` +
            'store it with: seed files are stored where @objectstack/service-storage runs (the field-files service). ' +
            'Load this seed through a server that composes the storage service.',
        );
      }
      planned.push({ field, def, contents });
    }

    const claims: Array<{ field: string; fileIds: string[] }> = [];
    for (const { field, def, contents } of planned) {
      // A file the matched row already holds, stored from the same path with
      // the same bytes, name and type, is kept; each held file serves once.
      const held = args.existing ? heldIdsOf(args.existing[field]) : [];
      const heldFiles = held.length > 0 ? await this.describe(held, args.organizationId) : new Map();
      const existingId = args.existing?.id == null ? undefined : String(args.existing.id);
      const unused = new Set(held);
      const fileIds: string[] = [];
      for (const { reference, bytes, content } of contents) {
        const name = reference.name ?? baseNameOf(reference.$file);
        const mimeType = reference.contentType ?? content.contentType;
        const kept = [...unused].find((id) => {
          const file = heldFiles.get(id);
          return file != null
            && (file.owner === null
              || (file.owner.object === this.objectName && file.owner.field === field && file.owner.recordId === existingId))
            && file.metadata[PROVENANCE_PATH] === reference.$file
            && file.metadata[PROVENANCE_SHA256] === content.sha256
            && file.name === name
            && file.mimeType === mimeType;
        });
        if (kept !== undefined) {
          unused.delete(kept);
          fileIds.push(kept);
          continue;
        }
        try {
          const stored = await this.service!.storeFile({
            organizationId: args.organizationId,
            filename: name,
            mimeType,
            data: bytes,
            metadata: { [PROVENANCE_PATH]: reference.$file, [PROVENANCE_SHA256]: content.sha256 },
          });
          fileIds.push(stored.fileId);
        } catch (err) {
          return this.refusal(
            field,
            reference,
            `${this.objectName}.${field}: seedFile('${reference.$file}') could not be stored — ` +
              `${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
      args.record[field] = def.multiple ? fileIds : fileIds[0];
      claims.push({ field, fileIds });
    }
    // [#26670] The row's files are stored (or kept): let a waiting request in.
    if (planned.length > 0) await yieldToEventLoop();
    return { ok: true, claims };
  }

  /**
   * After the row landed as `recordId`: make each field's slot the owner of
   * its files, committing them. Answers why the files are not the row's when a
   * claim fails, else `null`. A file the slot already owns, committed, costs
   * no write.
   */
  async settleRow(recordId: string, claims: SeedFileClaims, organizationId: string | null): Promise<string | null> {
    if (!this.service || claims.length === 0) return null;
    try {
      return await this.settleClaims(recordId, claims, organizationId);
    } finally {
      // [#26670] The loader settles a whole insert batch's rows back to back;
      // each row's claim ends with a turn for whatever request is waiting.
      await yieldToEventLoop();
    }
  }

  /** {@link settleRow}'s claims, field by field; the first failure ends it. */
  private async settleClaims(recordId: string, claims: SeedFileClaims, organizationId: string | null): Promise<string | null> {
    const service = this.service!;
    for (const { field, fileIds } of claims) {
      const known = await this.describe(fileIds, organizationId);
      const settled = fileIds.every((id) => {
        const file = known.get(id);
        return file?.status === 'committed'
          && file.owner?.object === this.objectName
          && file.owner.recordId === recordId
          && file.owner.field === field;
      });
      if (settled) continue;
      try {
        await service.claimFiles({ object: this.objectName, recordId, field }, fileIds, organizationId);
        this.forget(fileIds, organizationId);
      } catch (err) {
        return `${this.objectName}/${recordId}.${field} was written, but its seed file(s) ${fileIds.join(', ')} could ` +
          `not be made the record's own: ${(err as Error)?.message ?? String(err)}. The files stay pending and are ` +
          'reclaimed by the pending-upload retention, which leaves the field naming no file; re-run the seed to store ' +
          'them again.';
      }
    }
    return null;
  }

  private refusal(field: string, attemptedValue: unknown, message: string): SeedFileRowOutcome {
    return { ok: false, field, attemptedValue, message };
  }

  /** The bundled bytes of `path`, decoded once and checked against their recorded size and SHA-256. */
  private check(path: string): CheckedContent {
    const cached = this.checked.get(path);
    if (cached) return cached;
    let result: CheckedContent;
    const content = Object.prototype.hasOwnProperty.call(this.files, path) ? this.files[path] : undefined;
    if (!content) {
      result = {
        ok: false,
        reason:
          `seedFile('${path}') names a file this ${this.objectName} dataset does not carry: its \`files\` map has no ` +
          `entry for '${path}'. \`os build\` bundles each referenced file from the package root; build the package ` +
          'again (and check that the file exists there), or, for a dataset written by hand, add the bytes to `files`.',
      };
    } else {
      const bytes = Buffer.from(content.data, 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      result = bytes.byteLength !== content.size || sha256 !== content.sha256
        ? {
          ok: false,
          reason:
            `seedFile('${path}'): the bytes this ${this.objectName} dataset carries do not match what was recorded ` +
            `for them (${bytes.byteLength} bytes, SHA-256 ${sha256}; recorded ${content.size} bytes, SHA-256 ` +
            `${content.sha256}). The bundle was altered after \`os build\`; build the package again.`,
        }
        : { ok: true, bytes, content };
    }
    this.checked.set(path, result);
    return result;
  }

  /** The files among `ids` that exist in `organizationId`, read once per id and organization. */
  private async describe(
    ids: readonly string[],
    organizationId: string | null,
  ): Promise<Map<string, FieldFileDescription | null>> {
    const scope = organizationId ?? '';
    let cache = this.described.get(scope);
    if (!cache) this.described.set(scope, (cache = new Map()));
    const unknown = [...new Set(ids)].filter((id) => !cache!.has(id));
    for (let i = 0; i < unknown.length && this.service; i += DESCRIBE_CHUNK) {
      const chunk = unknown.slice(i, i + DESCRIBE_CHUNK);
      let found: Map<string, FieldFileDescription>;
      try {
        found = await this.service.describeFiles(chunk, organizationId);
      } catch (err) {
        if (!isMissingTableError(err, 'sys_file')) throw err;
        found = new Map();
      }
      for (const id of chunk) cache.set(id, found.get(id) ?? null);
    }
    return cache;
  }

  /** Drop what a claim just changed, so a later row reads it fresh. */
  private forget(ids: readonly string[], organizationId: string | null): void {
    const cache = this.described.get(organizationId ?? '');
    for (const id of ids) cache?.delete(id);
  }
}
