// Identity import adapter — framework#2782.
//
// `sys_user` cannot go through the generic `/api/v1/data/sys_user/import`
// route: a plain data-layer insert bypasses better-auth's password hashing and
// never creates the credential account, so imported "users" could never sign
// in. The server exposes a dedicated, platform-admin-gated endpoint instead
// (`POST /api/v1/auth/admin/import-users`) whose payload is deliberately
// byte-compatible with the generic import request.
//
// This module wraps the regular dataSource so the stock ImportWizard drives
// that endpoint unchanged: `importRecords` is overridden to (1) split rows
// into ≤500-row batches — the endpoint's hard cap, because password-related
// work is CPU-bound server-side — and (2) inject the admin's chosen password
// policy. The endpoint is idempotent on upsert (matched by email/phone), so
// re-running a failed batch is safe. A CSV file's request arrives as CSV text
// (objectui#13315) and each batch is posted as CSV text too, so the endpoint
// reads the file's cells through the same CSV rule as the generic import door;
// JSON rows (a workbook, a paste) are batched as JSON rows.
//
// Password policies: `auto` (default, framework#3236 — per row: deliverable
// rows get an invitation, unreachable rows fall back to a one-time password),
// `invite` (force an invitation — set-your-password email / SMS — for every
// row; unreachable rows fail), `temporary` (force a per-row one-time password
// for every row), `none` (identity only — users first sign in via phone OTP /
// magic link / reset link and set a password afterwards). One-time passwords
// (`auto` fallback rows and all of `temporary`) are returned ONLY in the
// response — the result step must surface them immediately; they are never
// persisted anywhere, client or server.

import type { ImportRecordsResult, ImportRequestOptions, ImportRowResult, ImportWriteMode } from '@object-ui/types';

export const IDENTITY_IMPORT_OBJECT = 'sys_user';

/** Server-side hard cap on rows per identity import request. */
export const IDENTITY_IMPORT_BATCH_SIZE = 500;

export type IdentityPasswordPolicy = 'auto' | 'none' | 'invite' | 'temporary';

/** Row results from the identity endpoint may carry a one-time password. */
export type IdentityImportRowResult = ImportRowResult & {
  temporaryPassword?: string;
  /** The row's sign-in identity (email or phone), enriched from the source
   *  rows by the adapter so the one-time-password reveal is usable. */
  identity?: string;
};

interface IdentityImportResponse {
  success: boolean;
  error?: { code?: string; message?: string };
  data?: {
    summary: {
      total: number;
      created: number;
      updated: number;
      skipped: number;
      errors: number;
      dryRun: boolean;
    };
    /**
     * Per-row outcomes. Typed by the shared `ImportRowResult` contract rather
     * than re-listed here (objectstack#4115): the hand copy this replaces had
     * drifted on `action`, declaring it optional where the import route's own
     * schema requires it — so every consumer carried a branch for a value the
     * route always sends. The identity endpoint adds one field of its own.
     */
    rows: Array<ImportRowResult & { temporaryPassword?: string }>;
  };
}

/** Split rows into endpoint-sized batches (pure; exported for tests). */
export function splitIntoBatches<T>(rows: T[], size = IDENTITY_IMPORT_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  return batches;
}

/** One record of a CSV request's text: the record as written, without its
 *  line break, and its cells. */
export interface CsvRequestRecord {
  text: string;
  cells: string[];
}

/**
 * Cut a CSV request's text into its records, header first (pure; exported for
 * tests). The text is the import wizard's (`sourceRowsToCsv` in
 * `@object-ui/plugin-grid`): records joined by CRLF, every cell holding a
 * quote, a comma, a CR or an LF quoted (RFC 4180). The scan splits records the
 * way the identity endpoint's CSV parse does — a quote opens a quoted run, a
 * doubled quote inside one is a quote, an LF outside one ends the record, a CR
 * outside one is dropped, and a last line holding nothing is no record — so a
 * record cut here is a row the endpoint reads, in the same order.
 *
 * A record's text is kept as written, so a batch re-joined from these texts
 * reaches the endpoint with the wizard's own bytes. The cells are read only to
 * name each row's identity in the result (see mergeIdentityBatchResults); no
 * imported value is decided here.
 */
export function readCsvRequestRecords(csv: string): CsvRequestRecord[] {
  const text = csv.replace(/^\uFEFF/, '');
  const records: CsvRequestRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let start = 0;
  let inQuotes = false;
  const close = (end: number) => {
    cells.push(cell);
    const written = text.slice(start, end);
    records.push({ text: written.endsWith('\r') ? written.slice(0, -1) : written, cells });
    cells = [];
    cell = '';
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else if (ch === '\n') close(i);
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length > 0 || cells.length > 0) close(text.length);
  return records;
}

/** One request to the identity endpoint: its payload, and the rows it carries
 *  (read back to name each row's identity in the result). */
export interface IdentityImportBatch {
  payload: { format: 'csv'; csv: string } | { format: 'json'; rows: Array<Record<string, unknown>> };
  rows: Array<Record<string, unknown>>;
}

/**
 * Split the wizard's request into endpoint-sized batches (pure; exported for
 * tests). CSV text (a CSV file, objectui#13315) is cut into records and every
 * batch is the header record plus up to `size` data records, joined by CRLF —
 * for the wizard's text, exactly `sourceRowsToCsv` of that batch's rows. JSON
 * rows (a workbook, a paste) are batched as JSON rows. Each batch carries its
 * rows in file order, so per-batch row numbers renumber onto the preview's.
 */
export function batchIdentityImportRequest(
  request: ImportRequestOptions,
  size = IDENTITY_IMPORT_BATCH_SIZE,
): IdentityImportBatch[] {
  if (request.format === 'csv' && typeof request.csv === 'string') {
    const [header, ...records] = readCsvRequestRecords(request.csv);
    if (!header) return [];
    const columns = header.cells.map((c) => c.trim());
    return splitIntoBatches(records, size).map((batch) => ({
      payload: { format: 'csv' as const, csv: [header, ...batch].map((r) => r.text).join('\r\n') },
      rows: batch.map((r) => Object.fromEntries(columns.map((column, i) => [column, r.cells[i] ?? '']))),
    }));
  }
  const rows = Array.isArray(request.rows) ? request.rows : [];
  return splitIntoBatches(rows, size).map((batch) => ({ payload: { format: 'json' as const, rows: batch }, rows: batch }));
}

/**
 * The write modes the identity import door accepts — stated once, here, beside
 * the refusal that enforces it (objectui#12697). The server serves no datum
 * naming them: `POST /api/v1/auth/admin/import-users` validates its `mode`
 * against `insert` / `upsert` inline (objectstack `plugin-auth`,
 * `admin-import-users.ts`, which answers `mode must be "insert" or "upsert"`), so this
 * constant is that door's read. {@link resolveIdentityWriteOptions} refuses
 * every mode outside it, and the host hands the same constant to the wizard as
 * `writeModes`, so the wizard never offers a mode this pipeline refuses.
 */
export const IDENTITY_IMPORT_WRITE_MODES = ['insert', 'upsert'] as const satisfies readonly ImportWriteMode[];

export type IdentityImportWriteMode = (typeof IDENTITY_IMPORT_WRITE_MODES)[number];

function isIdentityImportWriteMode(mode: ImportWriteMode): mode is IdentityImportWriteMode {
  return (IDENTITY_IMPORT_WRITE_MODES as readonly ImportWriteMode[]).includes(mode);
}

/**
 * Map the wizard's generic write options onto the identity endpoint's
 * `mode` / `matchBy`. Throws early (before any batch is sent) on options the
 * identity pipeline doesn't support, so the wizard surfaces one clear error
 * instead of a half-imported file.
 */
export function resolveIdentityWriteOptions(request: ImportRequestOptions): {
  mode: IdentityImportWriteMode;
  matchBy?: 'email' | 'phone';
} {
  const writeMode = request.writeMode ?? 'insert';
  if (!isIdentityImportWriteMode(writeMode)) {
    throw new Error(`Identity import supports the ${IDENTITY_IMPORT_WRITE_MODES.join(' and ')} write modes only.`);
  }
  if (writeMode === 'insert') return { mode: 'insert' };
  const match = (request.matchFields ?? [])[0];
  if (match === 'email') return { mode: 'upsert', matchBy: 'email' };
  if (match === 'phone_number') return { mode: 'upsert', matchBy: 'phone' };
  throw new Error('Identity import matches existing users by "email" or "phone_number" only.');
}

/**
 * Merge per-batch endpoint responses into one wizard-shaped
 * {@link ImportRecordsResult}, renumbering each batch's 1-based rows onto the
 * whole file (pure; exported for tests).
 */
export function mergeIdentityBatchResults(
  responses: Array<NonNullable<IdentityImportResponse['data']>>,
  batches: Array<Array<Record<string, unknown>>>,
  meta: { dryRun: boolean; writeMode: 'insert' | 'upsert' },
): ImportRecordsResult {
  let total = 0, created = 0, updated = 0, skipped = 0, errors = 0;
  const results: IdentityImportRowResult[] = [];
  let offset = 0;
  for (let b = 0; b < responses.length; b++) {
    const { summary, rows } = responses[b];
    const sourceRows = batches[b] ?? [];
    total += summary.total;
    created += summary.created;
    updated += summary.updated;
    skipped += summary.skipped;
    errors += summary.errors;
    for (const r of rows) {
      if (!r) continue;
      // Enrich with the row's sign-in identity so the one-time-password
      // reveal (and its CSV) pairs each password with a recognizable account.
      const source = sourceRows[r.row - 1] as { email?: unknown; phone_number?: unknown; phoneNumber?: unknown; phone?: unknown } | undefined;
      const identity = [source?.email, source?.phone_number, source?.phoneNumber, source?.phone]
        .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
      results.push({
        row: offset + r.row,
        ok: r.ok,
        action: r.action,
        ...(r.id ? { id: r.id } : {}),
        ...(r.field ? { field: r.field } : {}),
        ...(r.code ? { code: r.code } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.temporaryPassword ? { temporaryPassword: r.temporaryPassword } : {}),
        ...(identity ? { identity: identity.trim() } : {}),
      });
    }
    offset += sourceRows.length || summary.total;
  }
  return {
    object: IDENTITY_IMPORT_OBJECT,
    dryRun: meta.dryRun,
    writeMode: meta.writeMode,
    total,
    ok: total - errors,
    errors,
    created,
    updated,
    skipped,
    results,
  };
}

/**
 * The one capability identity import forwards off the base adapter's PROTOTYPE.
 * Shaped to match the wizard's own probe (`plugin-grid/src/ImportWizard.tsx`),
 * so what is forwarded here is exactly what the feature detection reads.
 */
type ImportMappingsCapableBase = {
  listImportMappings?: (objectName: string) => Promise<unknown[]>;
};

export interface IdentityImportDataSourceOptions {
  /** The regular dataSource — reads (and everything else) pass through. */
  base: unknown;
  /** Authenticated fetch (Bearer + tenant headers), e.g. createAuthenticatedFetch(). */
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Server origin (VITE_SERVER_URL); '' for same-origin. */
  baseUrl: string;
  /** Read the admin's currently selected password policy at send time. */
  getPasswordPolicy: () => IdentityPasswordPolicy;
}

/**
 * Wrap a dataSource so the ImportWizard writes through the identity endpoint.
 *
 * Also *removes* the async-job and undo surfaces: identity import is
 * synchronous-only server-side (batching happens here instead) and undo would
 * mean bulk-deleting users — the wizard feature-detects these methods, so
 * clearing them cleanly hides the corresponding UI.
 *
 * Saved import mappings are the one capability that goes the OTHER way: they
 * are offered here, and are forwarded explicitly for that reason (objectui#7740).
 */
export function createIdentityImportDataSource(opts: IdentityImportDataSourceOptions): unknown {
  const { base, authFetch, baseUrl, getPasswordPolicy } = opts;

  const importRecords = async (
    _objectName: string,
    request: ImportRequestOptions,
  ): Promise<ImportRecordsResult> => {
    const { mode, matchBy } = resolveIdentityWriteOptions(request);
    const passwordPolicy = getPasswordPolicy();
    const batches = batchIdentityImportRequest(request);
    if (batches.length === 0) {
      throw new Error('Identity import needs at least one mapped row (rows[] or csv).');
    }

    const responses: Array<NonNullable<IdentityImportResponse['data']>> = [];
    for (const batch of batches) {
      const res = await authFetch(`${baseUrl}/api/v1/auth/admin/import-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...batch.payload,
          mode,
          ...(matchBy ? { matchBy } : {}),
          passwordPolicy,
          ...(request.dryRun ? { dryRun: true } : {}),
          ...(request.mappingName ? { mappingName: request.mappingName } : {}),
          ...(request.trimWhitespace !== undefined ? { trimWhitespace: request.trimWhitespace } : {}),
          ...(request.nullValues ? { nullValues: request.nullValues } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as IdentityImportResponse | null;
      if (!res.ok || !body?.success || !body.data) {
        const message = body?.error?.message ?? `Identity import failed with status ${res.status}`;
        // Abort the remaining batches: the request-level failure (bad policy,
        // missing email service, …) would repeat identically for every batch.
        throw new Error(message);
      }
      responses.push(body.data);
    }

    return mergeIdentityBatchResults(
      responses,
      batches.map((batch) => batch.rows),
      { dryRun: request.dryRun === true, writeMode: mode },
    );
  };

  // Spread first, then null the surfaces identity import must not offer —
  // a plain spread would copy the generic job/undo methods along.
  //
  // The spread copies OWN enumerable properties only. When `base` is a class
  // instance — `ObjectStackAdapter` is — everything declared in its class body
  // lives on the PROTOTYPE and does not come across, so a capability the wizard
  // feature-detects can go missing here without anyone having expressed that.
  // Anything this wrapper means to offer off such a base has to say so.
  return {
    ...(base as Record<string, unknown>),
    importRecords,
    createImportJob: undefined,
    getImportJobProgress: undefined,
    getImportJobResults: undefined,
    listImportJobs: undefined,
    cancelImportJob: undefined,
    undoImportJob: undefined,
    // The server's import template describes the GENERIC import door of the
    // object (objectui#9600), not the identity pipeline this wrapper writes
    // through, whose target set is curated (`identityImportFields`). The
    // wizard offers the template only when this method is a function.
    downloadImportTemplate: undefined,
    // Saved mappings ARE offered for identity import — director-seat ruling,
    // decision batch #68 (objectui#7740, comment 5565349507; ledger on
    // objectstack#12708). Importing users benefits from saved field mappings
    // exactly as any other object does, and `importRecords` above already
    // forwards `mappingName` to a server that honours it — before this line
    // that forward was unreachable, because the selector that sets it could
    // never render.
    //
    // Forwarded as this one method rather than by widening the spread: widening
    // it would drag in every prototype method of the base adapter without a
    // census. `?.` keeps a base that lacks the method from gaining one, so the
    // six lines above and this one all say exactly what they mean.
    listImportMappings: (base as ImportMappingsCapableBase).listImportMappings?.bind(base),
  };
}

/** Rows that carry a one-time password, for the result-step reveal. */
export function collectTemporaryPasswords(
  result: ImportRecordsResult | undefined,
): Array<{ row: number; identity: string; temporaryPassword: string }> {
  if (!result?.results) return [];
  const out: Array<{ row: number; identity: string; temporaryPassword: string }> = [];
  for (const r of result.results as IdentityImportRowResult[]) {
    if (r?.temporaryPassword) {
      out.push({ row: r.row, identity: r.identity ?? `#${r.row}`, temporaryPassword: r.temporaryPassword });
    }
  }
  return out;
}

/** CSV for the one-time-password handout (client memory only — never persisted). */
export function buildTemporaryPasswordCsv(
  entries: Array<{ row: number; identity: string; temporaryPassword: string }>,
): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['row,identity,temporary_password'];
  for (const e of entries) lines.push(`${e.row},${esc(e.identity)},${esc(e.temporaryPassword)}`);
  return lines.join('\n');
}
