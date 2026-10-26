/**
 * Thin REST client for `/api/settings`. Matches the surface mounted by
 * `@objectstack/service-settings`.
 */

import type {
  SettingsActionResult,
  SettingsListResponse,
  SettingsNamespacePayload,
} from './types';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const BASE = `${SERVER_URL}/api/settings`;

/**
 * Unwrap the platform's declared success envelope, `{ success, data }`
 * (framework#3843).
 *
 * All five `/api/settings` responses moved into that envelope when
 * `settings-routes.ts` adopted `sendOk`/`sendError`; its changelog spelled out
 * the consequence for callers that do not go through `@objectstack/client`:
 * "Raw `fetch` callers must add one hop: `body.data`." This module is one of
 * those callers and did not take the hop, so every namespace page read the
 * envelope itself as the payload (objectui#3366).
 *
 * The predicate is character-for-character the one `ObjectStackClient
 * .unwrapResponse` applies (`framework/packages/client/src/index.ts`), and it
 * matters that it is that one and not something looser:
 *
 * - `'data' in body` is what keeps an ERROR envelope out of here. A failure is
 *   `{ success: false, error: {…} }` — `success` is a boolean, but there is no
 *   `data`, so the body is handed back whole and `jsonOrThrow` can still read
 *   `error.message` / park the body on `err.payload` for `lockedKeyOf` and
 *   `extractFieldErrors`.
 * - A body WITHOUT a boolean `success` is a pre-#3843 server answering the bare
 *   payload; it passes through untouched. The console ships as a versioned
 *   asset that outlives any single server build, which is why both generations
 *   are read rather than the old one being declared gone. Drop the passthrough
 *   once the oldest supported server carries #3843 — `api.envelope.test.ts`
 *   drives that branch explicitly, so deleting it is a red test naming the
 *   server generation it was carrying, not a silent regression.
 *
 * This is deliberately a local copy rather than an import: the console talks to
 * `/api/settings` with raw `fetch` and does not construct an `ObjectStackClient`,
 * and `unwrapResponse` is private to it.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (
    body !== null &&
    typeof body === 'object' &&
    typeof (body as { success?: unknown }).success === 'boolean' &&
    'data' in body
  ) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * Fail loudly when the unwrapped body is not the shape this endpoint promises.
 *
 * Both symptoms of objectui#3366 came from a wrong-shaped body travelling
 * onward as if it were right: `Object.entries(payload.values)` on the envelope
 * threw `Cannot convert undefined or null to object` and the whole page went to
 * the error boundary, while the hub's `r.manifests ?? []` turned the same
 * mistake into "no settings are registered" — a lie that sends the reader off
 * hunting a plugin bug. A named error at the boundary is both diagnosable and
 * renderable: `SettingsView` and `SettingsHub` already have an error state.
 *
 * This is a strict check on the contract, not tolerance for a third shape: it
 * accepts what #3843 declares and what the pre-#3843 server sent, and rejects
 * everything else by name instead of guessing.
 */
function assertShape<T>(value: unknown, keys: Array<keyof T & string>, what: string): T {
  const bag = value as Record<string, unknown> | null | undefined;
  const missing = keys.filter(
    (key) => !(bag && typeof bag === 'object') || bag[key] === null || bag[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Malformed response from ${what}: expected an object carrying ${missing
        .map((key) => `\`${key}\``)
        .join(', ')}.`,
    );
  }
  return value as T;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const err = new Error(detail?.error?.message ?? res.statusText) as Error & { status?: number; payload?: any };
    err.status = res.status;
    // The raw body, NOT unwrapped: `err.payload.error` is what the view reads
    // for the locked key and the per-field rejections (objectstack#4224).
    err.payload = detail;
    throw err;
  }
  return unwrapEnvelope(await res.json()) as T;
}

const jsonHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

/**
 * The env-locked key named by a `SETTINGS_LOCKED` error, read from whichever
 * position the serving version puts it in (objectstack#4224).
 *
 * It used to arrive as `error.key` — a SIBLING of `code`/`message` that
 * `ApiErrorSchema` never declared. That body was accepted only because the
 * schema is a plain `z.object` and strips undeclared keys rather than rejecting
 * them, so nothing on either side ever flagged it. objectstack#4224 moves it to
 * `error.details.key`, the slot the contract does declare.
 *
 * Declared home first, old position second, so the console names the key against
 * servers on either side of that change instead of rendering `undefined` for the
 * duration of the window. Drop the second read once the oldest supported server
 * carries the fix.
 *
 * Lives here rather than inline in the view because this module already owns
 * what the server's error body looks like (`jsonOrThrow` is what builds
 * `err.payload`), and because a compat shim that no test exercises is a compat
 * shim that gets deleted by the next person who reads only one of the two
 * shapes.
 */
export function lockedKeyOf(apiError: unknown): string | undefined {
  if (!apiError || typeof apiError !== 'object') return undefined;
  const e = apiError as { key?: unknown; details?: { key?: unknown } | null };
  const declared = e.details && typeof e.details === 'object' ? e.details.key : undefined;
  const found = declared ?? e.key;
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

export async function listSettingsManifests(): Promise<SettingsListResponse> {
  const res = await fetch(BASE, { credentials: 'include', headers: jsonHeaders() });
  const body = await jsonOrThrow<SettingsListResponse>(res);
  return assertShape<SettingsListResponse>(body, ['manifests'], 'GET /api/settings');
}

export async function getSettingsNamespace(namespace: string): Promise<SettingsNamespacePayload> {
  const res = await fetch(`${BASE}/${encodeURIComponent(namespace)}`, {
    credentials: 'include',
    headers: jsonHeaders(),
  });
  const body = await jsonOrThrow<SettingsNamespacePayload>(res);
  return assertShape<SettingsNamespacePayload>(
    body,
    ['manifest', 'values'],
    `GET /api/settings/${namespace}`,
  );
}

export async function saveSettingsNamespace(
  namespace: string,
  patch: Record<string, unknown>,
): Promise<{ values: SettingsNamespacePayload['values'] }> {
  const res = await fetch(`${BASE}/${encodeURIComponent(namespace)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  });
  const body = await jsonOrThrow<{ values: SettingsNamespacePayload['values'] }>(res);
  // The write's read-back is what the view merges into the on-screen values.
  // Before the unwrap it was the envelope, so the merge spread nothing and a
  // "saved" toast could sit above stale numbers (objectui#3366).
  return assertShape<{ values: SettingsNamespacePayload['values'] }>(
    body,
    ['values'],
    `PUT /api/settings/${namespace}`,
  );
}

export async function runSettingsAction(
  namespace: string,
  actionId: string,
  payload?: unknown,
): Promise<SettingsActionResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(actionId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders(),
    body: JSON.stringify(payload ?? {}),
  });
  // This endpoint answers a `SettingsActionResult` on both arms, but the two
  // arms park it in different places (framework#3843, `settings-routes.ts`):
  //
  //   ok:true  → 200 `{ success: true,  data: SettingsActionResult }`
  //   ok:false → 400 `{ success: false, error: { code: 'SETTINGS_ACTION_FAILED',
  //                                               message, details: <result> } }`
  //
  // The route keeps the whole result under `error.details` precisely so the
  // renderer's `message` / `severity` / `details` survive the 4xx. Reading them
  // from there is following that contract, not guessing at an alias.
  const body: unknown = await res.json().catch(() => null);

  // Success arm — envelope, or the bare result from a pre-#3843 server.
  const unwrapped = unwrapEnvelope(body);
  if (isActionResult(unwrapped)) return unwrapped;

  // Failure arm — the reported verdict, with its message and severity intact.
  // Without this the console fell back to `{ ok: res.ok, message: statusText }`
  // and rendered "Bad Request" where the action had said why.
  const apiError = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  if (isActionResult(apiError?.details)) return apiError.details;

  // Neither: a crash (`INTERNAL_ERROR`), a 403, or a non-JSON body. Keep the
  // server's sentence when there is one.
  const message = typeof apiError?.message === 'string' ? apiError.message : res.statusText;
  return { ok: res.ok, message };
}

/** A body that actually carries an action verdict — `ok` is the one required key. */
function isActionResult(value: unknown): value is SettingsActionResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}
