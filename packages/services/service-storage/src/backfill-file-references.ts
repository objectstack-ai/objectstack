// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { FILE_REFERENCE_TYPES, isFileIdToken, RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import type { IStorageService } from '@objectstack/spec/contracts';

/**
 * Legacy file-value backfill (ADR-0104 D3 wave 2).
 *
 * Converts the pre-reference forms a `file`/`image`/`avatar`/`video`/`audio`
 * field may hold — an inline metadata blob (`{url, name, size, …}`) or a bare
 * URL string — into the reference form: an opaque `sys_file` id, owned by the
 * record's field. Ownership is what a later, gated change consults before
 * deleting bytes, so a tenant must be backfilled (and then reconciled with
 * `verifyFileReferences`) before collection may be enabled.
 *
 * ## What it will and will not convert
 *
 *  - **A URL pointing at this platform's own resolver** (`…/storage/files/:id`)
 *    already names a `sys_file`; the field is rewritten to that bare id. No
 *    bytes move.
 *  - **A `data:` URI** carries its bytes inline; they are uploaded, a `sys_file`
 *    is created, and the field is rewritten to its id.
 *  - **An external URL** (`https://cdn.example.com/…`) is **reported, never
 *    converted.** Converting would mean fetching third-party content and
 *    silently re-hosting it — a bandwidth, licensing and privacy decision that
 *    is not a migration's to make. ADR-0104 R7 retires these toward an explicit
 *    `url` field instead, which under AI authoring is the point: it stops
 *    "managed file" and "external link" being the same declaration.
 *
 * ## Dry run by default
 *
 * Nothing is written unless `apply` is set. The dry-run report is the same
 * shape as the applied one, so the plan can be reviewed — and diffed against
 * what actually happened — before any tenant data changes.
 *
 * Idempotent: a value already in reference form is recorded as `already_id`
 * and left alone, so a partially-completed run is safe to repeat.
 */

// Raw-form reads: the backfill's subject is the STORED value. Without the
// raw marker, a live kernel's read resolver would re-expand every id this
// run (or a previous one) already wrote, so each pass would re-report the
// same values as freshly converted instead of `already_id` — the run would
// never converge to zero.
const SYSTEM_CTX = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as const;
const SCAN_PAGE_SIZE = 200;

/** `data:<mime>;base64,<payload>` — the only inline form carrying real bytes. */
const DATA_URI_RE = /^data:([^;,]*)(;base64)?,(.*)$/s;

export type BackfillActionKind =
  | 'already_id'
  | 'resolved_local_url'
  | 'uploaded_inline_data'
  | 'external_url_skipped'
  | 'unresolvable';

export interface BackfillAction {
  kind: BackfillActionKind;
  object: string;
  recordId: string;
  field: string;
  /** Short description of the value found (URLs truncated). */
  before: string;
  /** The `sys_file` id the field now names, when converted. */
  after?: string;
  detail: string;
}

export interface BackfillReport {
  scannedObjects: string[];
  scannedRecords: number;
  /** Values rewritten into reference form (or that would be, on a dry run). */
  converted: number;
  /** External URLs left alone — these need an explicit modelling decision. */
  externalUrls: number;
  /** Values that could not be interpreted at all. */
  unresolvable: number;
  /** Values already in reference form. */
  alreadyReferences: number;
  actions: BackfillAction[];
  /** False on a dry run — no writes were made. */
  applied: boolean;
  truncated: boolean;
}

export interface BackfillEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, any>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

export interface BackfillOptions {
  /** Restrict to these objects (default: every object with a file field). */
  objects?: string[];
  /** Write the conversions. Omit for a dry run (the default). */
  apply?: boolean;
  maxRecordsPerObject?: number;
}

export interface BackfillLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

function fileFieldsOf(engine: BackfillEngine, objectName: string): string[] {
  const schema: any = engine.getObject(objectName);
  if (!schema?.fields) return [];
  return Object.entries(schema.fields)
    .filter(([, def]: [string, any]) => def && FILE_REFERENCE_TYPES.has(def.type))
    .map(([name]) => name);
}

function truncate(v: string, n = 96): string {
  return v.length <= n ? v : `${v.slice(0, n)}…`;
}

/**
 * The `sys_file` id a URL names, if it points at this platform's own resolver
 * (`…/storage/files/<id>`, optionally `/url`-suffixed or query-decorated).
 *
 * Parsed structurally rather than with a pattern. The obvious regex for this is
 * unanchored at the head, so a hostile value repeating `/storage/files/` makes
 * the engine retry from every position — polynomial backtracking on data that,
 * here, comes straight out of tenant records. Slicing and splitting is linear
 * in the URL's length no matter what it contains.
 */
function localFileIdFrom(url: string): string | null {
  let path = url;
  for (const sep of ['?', '#']) {
    const at = path.indexOf(sep);
    if (at >= 0) path = path.slice(0, at);
  }
  if (path.endsWith('/url')) path = path.slice(0, -'/url'.length);
  while (path.endsWith('/')) path = path.slice(0, -1);

  const parts = path.split('/');
  if (parts.length < 3) return null;
  if (parts[parts.length - 3] !== 'storage' || parts[parts.length - 2] !== 'files') return null;
  const id = parts[parts.length - 1];
  return isFileIdToken(id) ? id : null;
}

/** The URL a legacy value points at, if any (inline blob or bare string). */
function urlOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const u = (value as any).url;
    if (typeof u === 'string' && u) return u;
  }
  return null;
}

/** Upload a `data:` URI's bytes and register the `sys_file` row. */
async function materializeDataUri(
  engine: BackfillEngine,
  storage: IStorageService,
  dataUri: string,
  legacy: unknown,
): Promise<string> {
  const m = DATA_URI_RE.exec(dataUri);
  if (!m) throw new Error('not a data: URI');
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = !!m[2];
  const payload = m[3] ?? '';
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf-8');

  const legacyName =
    legacy && typeof legacy === 'object' && typeof (legacy as any).name === 'string'
      ? (legacy as any).name
      : '';
  const newId = randomUUID();
  const name = legacyName || `${newId}`;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const key = `user/${newId}${ext}`;

  await storage.upload(key, bytes, { contentType: mime } as any);
  const now = new Date().toISOString();
  await engine.insert(
    'sys_file',
    {
      id: newId,
      key,
      name,
      mime_type: mime,
      size: bytes.length,
      scope: 'user',
      status: 'committed',
      created_at: now,
      updated_at: now,
    },
    { context: { ...SYSTEM_CTX } },
  );
  return newId;
}

/**
 * Scan legacy file values and convert what can be converted.
 *
 * @param getStorage resolves the storage service; when absent, `data:` values
 *   cannot be materialised and are reported `unresolvable` rather than failing
 *   the run — a URL-only tenant still backfills fully.
 */
export async function backfillFileReferences(
  engine: BackfillEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: BackfillLogger,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const apply = options.apply === true;
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const actions: BackfillAction[] = [];
  let scannedRecords = 0;
  let truncated = false;

  const candidates =
    options.objects ??
    (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);
  const scannedObjects = candidates.filter(
    (name) => name !== 'sys_file' && fileFieldsOf(engine, name).length > 0,
  );

  for (const object of scannedObjects) {
    const fileFields = fileFieldsOf(engine, object);
    let offset = 0;

    for (;;) {
      let page: Array<Record<string, unknown>>;
      try {
        page = await engine.find(object, {
          fields: ['id', ...fileFields],
          limit: SCAN_PAGE_SIZE,
          offset,
          context: { ...SYSTEM_CTX },
        });
      } catch (err) {
        logger.warn(
          `[storage] backfill: cannot read ${object} (${(err as Error)?.message ?? err}) — skipped`,
        );
        break;
      }
      if (!page || page.length === 0) break;

      for (const record of page) {
        const recordId = record?.id;
        if (recordId == null) continue;
        scannedRecords++;

        for (const field of fileFields) {
          const raw = record[field];
          if (raw == null) continue;
          const isArray = Array.isArray(raw);
          const values = isArray ? raw : [raw];
          const next: unknown[] = [];
          let changed = false;

          for (const value of values) {
            const record_ = { object, recordId: String(recordId), field };

            if (isFileIdToken(value)) {
              actions.push({
                ...record_,
                kind: 'already_id',
                before: String(value),
                after: String(value),
                detail: 'already in reference form',
              });
              next.push(value);
              continue;
            }

            const url = urlOf(value);
            if (!url) {
              actions.push({
                ...record_,
                kind: 'unresolvable',
                before: truncate(typeof value === 'string' ? value : JSON.stringify(value ?? null)),
                detail: 'no url to interpret — left as-is',
              });
              next.push(value);
              continue;
            }

            const fileId = localFileIdFrom(url);
            if (fileId) {
              actions.push({
                ...record_,
                kind: 'resolved_local_url',
                before: truncate(url),
                after: fileId,
                detail: 'url already names a sys_file — rewritten to the bare id, no bytes moved',
              });
              next.push(fileId);
              changed = true;
              continue;
            }

            if (url.startsWith('data:')) {
              const storage = getStorage();
              if (!storage) {
                actions.push({
                  ...record_,
                  kind: 'unresolvable',
                  before: truncate(url),
                  detail: 'inline data: bytes need a storage service to materialise — left as-is',
                });
                next.push(value);
                continue;
              }
              if (!apply) {
                actions.push({
                  ...record_,
                  kind: 'uploaded_inline_data',
                  before: truncate(url),
                  detail: 'would upload the inline bytes and rewrite to the new file id (dry run)',
                });
                next.push(value);
                changed = true;
                continue;
              }
              try {
                const newId = await materializeDataUri(engine, storage, url, value);
                actions.push({
                  ...record_,
                  kind: 'uploaded_inline_data',
                  before: truncate(url),
                  after: newId,
                  detail: 'inline bytes uploaded and registered as a sys_file',
                });
                next.push(newId);
                changed = true;
              } catch (err) {
                actions.push({
                  ...record_,
                  kind: 'unresolvable',
                  before: truncate(url),
                  detail: `failed to materialise inline bytes (${(err as Error)?.message ?? err}) — left as-is`,
                });
                next.push(value);
              }
              continue;
            }

            // External URL. Deliberately not converted — see the module docs.
            actions.push({
              ...record_,
              kind: 'external_url_skipped',
              before: truncate(url),
              detail:
                'external URL — not re-hosted; model it as a `url` field rather than a file field (ADR-0104 R7)',
            });
            next.push(value);
          }

          if (!changed || !apply) continue;
          try {
            await engine.update(
              object,
              { id: recordId, [field]: isArray ? next : next[0] },
              { context: { ...SYSTEM_CTX } },
            );
            // The claim hooks installed by installFileReferenceHooks see this
            // write and record ownership — the backfill does not write the
            // ref_* columns itself, so there is exactly one claiming path.
          } catch (err) {
            logger.warn(
              `[storage] backfill: failed to rewrite ${object}/${String(recordId)}.${field} ` +
                `(${(err as Error)?.message ?? err})`,
            );
          }
        }
      }

      offset += page.length;
      if (page.length < SCAN_PAGE_SIZE) break;
      if (offset >= maxPerObject) {
        truncated = true;
        break;
      }
    }
  }

  const count = (k: BackfillActionKind) => actions.filter((a) => a.kind === k).length;
  return {
    scannedObjects,
    scannedRecords,
    converted: count('resolved_local_url') + count('uploaded_inline_data'),
    externalUrls: count('external_url_skipped'),
    unresolvable: count('unresolvable'),
    alreadyReferences: count('already_id'),
    actions,
    applied: apply,
    truncated,
  };
}

/** Render a backfill report as human-readable lines. */
export function formatBackfillReport(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.applied ? 'Backfill applied' : 'Backfill DRY RUN (nothing written)'} — ` +
      `${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s).`,
  );
  lines.push(
    `  converted: ${report.converted}   already references: ${report.alreadyReferences}   ` +
      `external URLs left: ${report.externalUrls}   unresolvable: ${report.unresolvable}`,
  );
  if (report.truncated) {
    lines.push('⚠ Scan was truncated by maxRecordsPerObject — re-run to continue.');
  }
  if (report.externalUrls > 0) {
    lines.push(
      `\nExternal URLs are NOT re-hosted. Each needs a modelling decision — a \`url\` field rather ` +
        `than a file field (ADR-0104 R7). They stay readable meanwhile:`,
    );
    for (const a of report.actions.filter((x) => x.kind === 'external_url_skipped').slice(0, 20)) {
      lines.push(`   ${a.object}/${a.recordId}.${a.field}: ${a.before}`);
    }
    const extra = report.externalUrls - 20;
    if (extra > 0) lines.push(`   … and ${extra} more`);
  }
  if (report.unresolvable > 0) {
    lines.push(`\nUnresolvable values (left untouched):`);
    for (const a of report.actions.filter((x) => x.kind === 'unresolvable').slice(0, 20)) {
      lines.push(`   ${a.object}/${a.recordId}.${a.field}: ${a.detail}`);
    }
  }
  if (!report.applied && report.converted > 0) {
    lines.push(`\nRe-run with apply to perform ${report.converted} conversion(s).`);
  }
  if (report.applied) {
    lines.push('\nNext: run verifyFileReferences to confirm ownership matches what records hold.');
  }
  return lines.join('\n');
}
