// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector credential door, as the console reads and writes it — Setup →
 * Integrations → Connector Credentials and the credential step after a
 * marketplace install both go through here (ruling A on objectstack#27230).
 *
 * Three routes, all on the automation domain and all asking `manage_metadata`:
 *
 *   GET    /api/v1/automation/connectors/credential-refs
 *   PUT    /api/v1/automation/connectors/credential-refs/:ref   { value }
 *   DELETE /api/v1/automation/connectors/credential-refs/:ref
 *
 * ⛔ No value is ever read back: every answer is a `ConnectorCredentialRef`,
 * which carries the reference, its source and status, never what it resolves
 * to. The only value that crosses this module is the one an administrator
 * typed, on its way into a `PUT` body.
 *
 * An empty value leaves the credential unchanged (ADR-0007's render rule for a
 * secret input): {@link putConnectorCredential} sends nothing for one, and the
 * forms that call it never ask.
 */

import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';
import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { componentRefToUrlSegments } from '../../services/componentRegistry.js';

/**
 * The console component Setup's entry names. The entry itself is contributed
 * by the automation service's UI bundle (`CONNECTOR_CREDENTIALS_UI_BUNDLE` in
 * `@objectstack/service-automation`), never declared by the shell.
 */
export const CONNECTOR_CREDENTIALS_REF = 'automation:connector-credentials';

/** Where the page opens inside the Setup app — the URL the entry's ref builds. */
export function connectorCredentialsPagePath(): string {
  return `/apps/setup/component/${componentRefToUrlSegments(CONNECTOR_CREDENTIALS_REF).join('/')}`;
}

/**
 * What a listing read concluded.
 *
 *   - `listed` — the door answered; `refs` may be empty.
 *   - `not-served` — `404` / `405`: this runtime has no such route, an older
 *     runtime than the door. A configuration conclusion, not a failure.
 *   - `unavailable` — `403` / `501` / `503`: the route is there and refused to
 *     list, for a reason of this deployment's configuration — a walled tenancy
 *     posture or a missing capability (`403`), an automation service that does
 *     not implement the door (`501`), a store that cannot be read now (`503`).
 *     `message` is the server's own sentence, which names the condition and
 *     its remedy; it is rendered, never parsed.
 *   - `failed` — anything else: a real failure to load.
 */
export type CredentialListing =
  | { kind: 'listed'; refs: ConnectorCredentialRef[] }
  | { kind: 'not-served' }
  | { kind: 'unavailable'; status: number; message: string }
  | { kind: 'failed'; message: string };

/** What a set or a clear came back with: the reference's new entry, or the refusal's own words. */
export type CredentialWrite =
  | { ok: true; entry: ConnectorCredentialRef }
  | { ok: false; status: number; message: string };

const NOT_SERVED_STATUSES = new Set([404, 405]);
const UNAVAILABLE_STATUSES = new Set([403, 501, 503]);

function isCredentialRef(row: unknown): row is ConnectorCredentialRef {
  const r = row as { ref?: unknown; status?: unknown; connectors?: unknown } | null;
  return (
    typeof r?.ref === 'string' && r.ref.length > 0
    && (r.status === 'set' || r.status === 'missing' || r.status === 'rejected')
    && Array.isArray(r.connectors)
  );
}

/** The success envelope's `data` — the one shape the automation domain answers with. */
function dataOf(payload: unknown): Record<string, unknown> | undefined {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
}

function refused(payload: unknown): boolean {
  return (payload as { success?: unknown } | null | undefined)?.success === false;
}

/** The listing read's conclusion from its status and body. Separate from the fetch so it is tested directly. */
export function readCredentialListing(status: number, payload: unknown): CredentialListing {
  if (NOT_SERVED_STATUSES.has(status)) return { kind: 'not-served' };
  if (UNAVAILABLE_STATUSES.has(status)) {
    return { kind: 'unavailable', status, message: actionErrorDetail(payload, `HTTP ${status}`) };
  }
  if (status < 200 || status >= 300 || refused(payload)) {
    return { kind: 'failed', message: actionErrorDetail(payload, `HTTP ${status}`) };
  }
  const list = dataOf(payload)?.credentialRefs;
  if (!Array.isArray(list)) {
    return { kind: 'failed', message: 'The credential listing answered without a credentialRefs list.' };
  }
  return { kind: 'listed', refs: list.filter(isCredentialRef) };
}

/** A write's conclusion from its status and body. */
export function readCredentialWrite(status: number, payload: unknown): CredentialWrite {
  if (status >= 200 && status < 300 && !refused(payload)) {
    const entry = dataOf(payload);
    if (isCredentialRef(entry)) return { ok: true, entry };
    return { ok: false, status, message: 'The credential door answered without the entry of the reference it wrote.' };
  }
  return { ok: false, status, message: actionErrorDetail(payload, `HTTP ${status}`) };
}

const JSON_HEADERS = { Accept: 'application/json' } as const;

function doorUrl(ref?: string): string {
  const base = `${apiBase()}/automation/connectors/credential-refs`;
  return ref === undefined ? base : `${base}/${encodeURIComponent(ref)}`;
}

async function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** `GET …/credential-refs`. A network failure reads as `failed`, never as an empty list. */
export async function fetchCredentialListing(signal?: AbortSignal): Promise<CredentialListing> {
  let res: Response;
  try {
    res = await fetch(doorUrl(), { credentials: 'include', headers: JSON_HEADERS, cache: 'no-store', signal });
  } catch (err) {
    if ((err as { name?: unknown })?.name === 'AbortError') throw err;
    return { kind: 'failed', message: (err as Error)?.message ?? String(err) };
  }
  return readCredentialListing(res.status, await bodyOf(res));
}

/**
 * `PUT …/credential-refs/:ref` with `{ value }`. An empty value is not sent:
 * it means "leave the credential unchanged", so there is nothing to write.
 */
export async function putConnectorCredential(ref: string, value: string): Promise<CredentialWrite | null> {
  if (value.length === 0) return null;
  let res: Response;
  try {
    res = await fetch(doorUrl(ref), {
      method: 'PUT',
      credentials: 'include',
      headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error)?.message ?? String(err) };
  }
  return readCredentialWrite(res.status, await bodyOf(res));
}

/** `DELETE …/credential-refs/:ref`. */
export async function clearConnectorCredential(ref: string): Promise<CredentialWrite> {
  let res: Response;
  try {
    res = await fetch(doorUrl(ref), { method: 'DELETE', credentials: 'include', headers: JSON_HEADERS });
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error)?.message ?? String(err) };
  }
  return readCredentialWrite(res.status, await bodyOf(res));
}

/**
 * The references a just-installed package declares that still need an
 * administrator: not `set`, still declared, writable by the door, and named by
 * one of that package's connector instances (`connectors[].packageId`, the
 * package id the registry stamps on each declared instance).
 *
 * `rejected` is included: the upstream refused the value it has, so the
 * administrator has one to correct. An environment-sourced reference is never
 * here — it is `writable: false`, and the door would refuse it.
 */
export function refsAwaitingPackage(refs: readonly ConnectorCredentialRef[], packageId: string): ConnectorCredentialRef[] {
  return refs.filter(
    (r) => r.status !== 'set'
      && r.declared
      && r.writable
      && r.connectors.some((c) => c.packageId === packageId),
  );
}
