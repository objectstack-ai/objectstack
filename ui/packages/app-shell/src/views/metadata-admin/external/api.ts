// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Thin REST client for the External Datasource Federation routes
 * (ADR-0015 §6.2, framework `registerExternalDatasourceRoutes`).
 *
 * Mounted server-side under `/api/v1/datasources/:name/external/*`. Each
 * payload below arrives INSIDE the `{ success: true, data }` envelope — the
 * shared `sendOk` writes every success body on these routes — and
 * {@link readExternalData} is the one place that unwraps it:
 *
 *   GET  /tables[?schema=]              → data: { tables: RemoteTable[] }
 *   POST /tables/:remote/draft          → data: { draft: ObjectDraft }
 *   POST /refresh-catalog               → data: { catalog: ExternalCatalog }
 *   POST /validate                      → data: { ok, results: SchemaValidationResult[] }
 *
 * A refusal is the ADR-0112 envelope `{ success: false, error: { code,
 * message } }`, written by the shared `sendError`. Every route degrades to
 * `503` with `error.code` `SERVICE_UNAVAILABLE` when the host has not wired
 * the `external-datasource` service — callers surface that as a "federation
 * not enabled on this server" hint rather than a hard error.
 *
 * All calls go through `createAuthenticatedFetch()` so the Bearer token,
 * `X-Tenant-ID`, and `Accept-Language` are injected exactly like every other
 * app-shell REST call (RecordDetailView, ObjectView, …).
 */

import { createAuthenticatedFetch } from '@object-ui/auth';
// objectui#8676 - this module is the SECOND of the three in-repo doors that PUT
// `/meta/:type/:name`, and the one no `client.save(` or `.saveItem(` sweep can
// see: it is a hand-rolled fetch. It writes `object` metadata, so it applies the
// same invariant `MetadataClient.save` applies, from the same module.
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';
import { readEnvelopeFailureText } from '../../../utils/apiErrorEnvelope.js';
import type {
  GenerateDraftOpts,
  ObjectDraft,
  RemoteTable,
  SchemaValidationResult,
} from '@objectstack/spec/contracts';
import type { ExternalCatalog } from '@objectstack/spec/data';

// ---------------------------------------------------------------------------
// Contract types — RE-EXPORTED from `@objectstack/spec`, not mirrored.
//
// These nine used to be hand-written copies under the spec's own names, with a
// comment claiming they were "kept local so app-shell does not take a build
// dependency on the framework spec package". That reason was already false:
// `@objectstack/spec` is a direct dependency of this package (package.json),
// and the copies had drifted (objectstack#4115) — `SchemaDiffEntryKind` was
// missing `index_mismatch` and `unmapped_index`, so a validate run that
// reported an index divergence hit a `kind` this UI could not name, and
// `ExternalColumn.primaryKey` was optional here while the server always sends
// it (the spec schema defaults it to `false`).
//
// The wire shapes are produced by the framework parsing with these very
// schemas, so the spec's types are the accurate ones by construction. Import
// them; do not re-describe them.
// ---------------------------------------------------------------------------

/**
 * Introspection + drafting contracts (ADR-0015 §6.2), owned by
 * `@objectstack/spec/contracts`.
 */
export type {
  RemoteTable,
  GenerateDraftOpts,
  ObjectDraft,
  SchemaValidationResult,
} from '@objectstack/spec/contracts';

/**
 * Schema-divergence vocabulary, owned by `@objectstack/spec/shared` — shared
 * with the framework's `external-errors` module so a diff `kind` this UI
 * renders is exactly a `kind` the server can emit.
 */
export type { SchemaDiffEntry, SchemaDiffEntryKind } from '@objectstack/spec/shared';

/**
 * Catalog-snapshot shapes, owned by `@objectstack/spec/data` (the
 * `ExternalCatalogSchema` family the refresh-catalog route parses with).
 */
export type { ExternalCatalog, ExternalColumn, ExternalTable } from '@objectstack/spec/data';

/**
 * Raised when the server replies `503` with the envelope code
 * `SERVICE_UNAVAILABLE` — the federation service is not wired into this host.
 * Callers render a friendly "enable federation on the server" message instead
 * of a generic failure.
 */
export class ExternalServiceUnavailableError extends Error {
  constructor() {
    super('external_service_unavailable');
    this.name = 'ExternalServiceUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const authFetch = createAuthenticatedFetch();

function serverBase(): string {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SERVER_URL ?? '';
  return raw.replace(/\/+$/, '');
}

function externalBase(datasource: string): string {
  return `${serverBase()}/api/v1/datasources/${encodeURIComponent(datasource)}/external`;
}

/** The parsed body, or `undefined` when there is none to parse (a proxy's HTML 502). */
async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** `error.code` of an ADR-0112 refusal envelope, or `''` when the body is not one. */
function envelopeErrorCode(body: unknown): string {
  const error = (body as { error?: unknown } | null | undefined)?.error;
  if (!error || typeof error !== 'object') return '';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : '';
}

/**
 * Read one answer of the `/external/*` routes: the route's payload, unwrapped
 * from the `{ success: true, data }` envelope (objectui#11628).
 *
 * ## Why the unwrap lives here, once
 *
 * This client used to return the WHOLE body and read `tables` / `draft` /
 * `catalog` / `{ ok, results }` off its top level, where the server never puts
 * them. The panel therefore listed no remote tables (`tables ?? []` turned the
 * miss into an empty list), showed no catalog timestamp, and crashed the
 * Validation tab on `results.length`, while this module's tests mocked the bare
 * payload and stayed green. Every route here answers through the same `sendOk`,
 * so the envelope is unwrapped in this one reader and each caller reads its
 * own payload key off `data`.
 *
 * A 2xx body that is NOT that envelope is refused, naming the route, rather
 * than read as an empty answer: these routes have one success shape, and
 * reading anything else as "nothing there" is exactly how the defect hid.
 *
 * ## Refusals
 *
 * The ADR-0112 envelope `{ success: false, error: { code, message } }`, read by
 * {@link readEnvelopeFailureText} — app-shell's one rule for the prose a
 * person is shown. The old reader ran `String(body.error)` over the nested
 * object, so every refusal on this panel read `[object Object]`, and its 503
 * arm compared that same string with the pre-ADR-0112 code
 * `external_service_unavailable`, so the "federation not enabled" hint could
 * never show. The 503 is recognised by the envelope's own `code` now.
 */
async function readExternalData<T>(res: Response, url: string): Promise<T> {
  const body = await readBody(res);
  if (!res.ok) {
    if (res.status === 503 && envelopeErrorCode(body) === 'SERVICE_UNAVAILABLE') {
      throw new ExternalServiceUnavailableError();
    }
    throw new Error(readEnvelopeFailureText(body) ?? `${res.status} ${res.statusText}`);
  }
  const envelope = body as { success?: unknown; data?: unknown } | null | undefined;
  if (envelope?.success !== true || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error(`${url} answered ${res.status} without the { success: true, data } envelope.`);
  }
  return envelope.data as T;
}

/** List remote tables, optionally filtered to a single remote schema. */
export async function listRemoteTables(
  datasource: string,
  opts: { schema?: string } = {},
): Promise<RemoteTable[]> {
  const qs = opts.schema ? `?schema=${encodeURIComponent(opts.schema)}` : '';
  const url = `${externalBase(datasource)}/tables${qs}`;
  const res = await authFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await readExternalData<{ tables: RemoteTable[] }>(res, url);
  return data.tables;
}

/** Generate an Object draft (structured + `*.object.ts` source) from a table. */
export async function generateObjectDraft(
  datasource: string,
  remoteName: string,
  opts: GenerateDraftOpts = {},
): Promise<ObjectDraft> {
  const url = `${externalBase(datasource)}/tables/${encodeURIComponent(remoteName)}/draft`;
  const res = await authFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data = await readExternalData<{ draft: ObjectDraft }>(res, url);
  return data.draft;
}

/** Refresh and return the cached remote-schema snapshot. */
export async function refreshCatalog(datasource: string): Promise<ExternalCatalog> {
  const url = `${externalBase(datasource)}/refresh-catalog`;
  const res = await authFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const data = await readExternalData<{ catalog: ExternalCatalog }>(res, url);
  return data.catalog;
}

/** Validate every federated Object bound to this datasource. */
export async function validateDatasource(
  datasource: string,
): Promise<{ ok: boolean; results: SchemaValidationResult[] }> {
  const url = `${externalBase(datasource)}/validate`;
  const res = await authFetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  return readExternalData<{ ok: boolean; results: SchemaValidationResult[] }>(res, url);
}

/**
 * Persist a generated Object draft as a real `object` metadata item
 * (PUT `/api/v1/meta/object/:name`, mirroring `MetadataClient.save`). The
 * draft's `definition` is the parseable ObjectSchema body.
 *
 * ⛔ Not {@link readExternalData}: this is the `/meta` door, not an
 * `/external/*` route, and it answers in its own shapes (objectui#11628,
 * measured against a live showcase). Its success body is the save result
 * itself (`{ success, version, seq, state, message }`, no `data`), which
 * nothing here reads. Its refusals come in two dialects, and the door answers
 * both: the capability gate writes the nested `{ error: { code, message } }`
 * (a caller without `manage_metadata` gets `403 FORBIDDEN` in it), while a
 * spec-validation refusal writes the flat `{ error: '<sentence>', code }`
 * (`422 INVALID_METADATA`, `400 VALIDATION_ERROR`). The old reader handled the
 * flat one only, and printed the 403 as `[object Object]`.
 */
export async function importObjectDraft(draft: ObjectDraft): Promise<void> {
  assertObjectMetadataWritable('object', draft.definition, 'importObjectDraft');
  const res = await authFetch(
    `${serverBase()}/api/v1/meta/object/${encodeURIComponent(draft.name)}`,
    {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(draft.definition),
    },
  );
  if (res.ok) return;
  const body = await readBody(res);
  const flat = (body as { error?: unknown } | null | undefined)?.error;
  throw new Error(
    readEnvelopeFailureText(body) ??
      (typeof flat === 'string' && flat ? flat : `${res.status} ${res.statusText}`),
  );
}
